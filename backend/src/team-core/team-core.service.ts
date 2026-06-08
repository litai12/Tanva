import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class TeamCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ── 注册时内部调用 ──────────────────────────────────────────
  async createPersonalTeam(userId: string, tx?: any) {
    const db = tx ?? this.prisma;
    // Prisma 扩展不注入嵌套写：显式补 tenantId 给嵌套创建的租户表行（TeamMembership / TeamCreditAccount）
    const tenantId = this.tenantContext.getTenantId();
    const team = await db.team.create({
      data: {
        name: '我的工作区',
        ownerId: userId,
        isPersonal: true,
        maxSeats: 1,
        memberships: {
          create: { userId, role: 'owner', tenantId },
        },
        creditAccount: { create: { tenantId } },
      },
    });
    return team;
  }

  // ── 创建真实团队 ────────────────────────────────────────────
  async createTeam(userId: string, dto: CreateTeamDto) {
    // Prisma 扩展不注入嵌套写：显式补 tenantId 给嵌套创建的租户表行（TeamMembership / TeamCreditAccount）
    const tenantId = this.tenantContext.getTenantId();
    return this.prisma.team.create({
      data: {
        name: dto.name,
        ownerId: userId,
        isPersonal: false,
        maxSeats: 2,
        memberships: {
          create: { userId, role: 'owner', tenantId },
        },
        creditAccount: { create: { tenantId } },
      },
    });
  }

  async getMyTeams(userId: string) {
    // 兼容历史用户：注册早于「个人团队」功能的账号没有个人团队行，
    // 会导致前端无法切换到个人工作区。这里惰性补建。
    const personal = await this.prisma.team.findFirst({
      where: { ownerId: userId, isPersonal: true },
      select: { id: true },
    });
    if (!personal) {
      await this.createPersonalTeam(userId);
    }
    const memberships = await this.prisma.teamMembership.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            _count: { select: { memberships: true } },
            creditAccount: { select: { balance: true, frozenBalance: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      ...m.team,
      myRole: m.role,
      memberCount: m.team._count.memberships,
      availableCredits:
        (m.team.creditAccount?.balance ?? 0) -
        (m.team.creditAccount?.frozenBalance ?? 0),
    }));
  }

  async getTeam(teamId: string, requestingUserId: string) {
    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: requestingUserId } },
    });
    if (!membership) throw new ForbiddenException('非团队成员');
    return this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: { _count: { select: { memberships: true } } },
    });
  }

  async dissolveTeam(teamId: string, requestingUserId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new ForbiddenException('个人团队不可解散');
    if (team.ownerId !== requestingUserId) throw new ForbiddenException('仅 owner 可解散团队');

    await this.prisma.$transaction(async (tx) => {
      // 释放冻结积分（保留账户记录供审计）
      await tx.teamCreditAccount.updateMany({
        where: { teamId },
        data: { frozenBalance: 0 },
      });
      // 取消活跃订阅
      await tx.teamSubscription.updateMany({
        where: { teamId, status: 'active' },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      // 软删除团队（级联 status 传递通过子查询过滤；硬删除会触发 Cascade）
      // 先软标记，保留审计记录
      await tx.team.update({ where: { id: teamId }, data: { status: 'dissolved' } });
      // 显式清理：成员、邀请、项目共享（不依赖级联以确保软删除后数据一致）
      await tx.teamMembership.deleteMany({ where: { teamId } });
      await tx.teamInvite.deleteMany({ where: { teamId } });
      await tx.teamProjectShare.deleteMany({ where: { teamId } });
    });
  }

  async getMembers(teamId: string, requestingUserId: string) {
    await this.assertMember(teamId, requestingUserId);
    return this.prisma.teamMembership.findMany({
      where: { teamId },
      include: { user: { select: { id: true, name: true, avatarUrl: true, email: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async setMemberQuota(
    teamId: string,
    targetUserId: string,
    quota: { monthly?: number | null; total?: number | null },
    requestingUserId: string,
  ) {
    await this.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new ForbiddenException('个人团队不支持成员配额');
    await this.prisma.teamMembership.findUniqueOrThrow({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    return this.prisma.teamMembership.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: {
        creditQuotaMonthly: quota.monthly,
        creditQuotaTotal: quota.total,
      },
    });
  }

  async updateMemberRole(
    teamId: string,
    targetUserId: string,
    role: 'admin' | 'member',
    requestingUserId: string,
  ) {
    await this.assertRole(teamId, requestingUserId, ['owner']);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new ForbiddenException('个人团队不可修改角色');
    if (targetUserId === requestingUserId) throw new BadRequestException('不可修改自己的角色');
    return this.prisma.teamMembership.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { role },
    });
  }

  async removeMember(teamId: string, targetUserId: string, requestingUserId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new ForbiddenException('个人团队不可移除成员');

    // 自行退出
    if (targetUserId === requestingUserId) {
      return this.handleSelfLeave(team, targetUserId);
    }

    // 被他人移除：需要 owner 或 admin 权限
    await this.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    const target = await this.prisma.teamMembership.findUniqueOrThrow({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    if (target.role === 'owner') throw new ForbiddenException('不可移除 owner');
    await this.prisma.teamMembership.delete({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
  }

  async transferOwnership(teamId: string, newOwnerId: string, requestingUserId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new ForbiddenException('个人团队不可转让');
    if (team.ownerId !== requestingUserId) throw new ForbiddenException('仅 owner 可转让');

    await this.prisma.$transaction(async (tx) => {
      // 在事务内验证 newOwner 仍是成员（防止并发移除）
      const newOwnerMembership = await tx.teamMembership.findUnique({
        where: { teamId_userId: { teamId, userId: newOwnerId } },
      });
      if (!newOwnerMembership) throw new ForbiddenException('新 owner 不是团队成员');

      await tx.team.update({ where: { id: teamId }, data: { ownerId: newOwnerId } });
      await tx.teamMembership.update({
        where: { teamId_userId: { teamId, userId: requestingUserId } },
        data: { role: 'member' },
      });
      await tx.teamMembership.update({
        where: { teamId_userId: { teamId, userId: newOwnerId } },
        data: { role: 'owner' },
      });
    });
  }

  // ── 内部辅助 ────────────────────────────────────────────────
  async assertMember(teamId: string, userId: string) {
    const m = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!m) throw new ForbiddenException('非团队成员');
    return m;
  }

  async assertRole(teamId: string, userId: string, roles: string[]) {
    const m = await this.assertMember(teamId, userId);
    if (!roles.includes(m.role)) throw new ForbiddenException('权限不足');
    return m;
  }

  async getPersonalTeam(userId: string) {
    return this.prisma.team.findFirst({
      where: { ownerId: userId, isPersonal: true },
    });
  }

  private async handleSelfLeave(team: any, userId: string) {
    const members = await this.prisma.teamMembership.findMany({
      where: { teamId: team.id },
      orderBy: { createdAt: 'asc' },
    });

    if (members.length === 1) {
      // 最后一人，解散（handleSelfLeave 只在非个人团队场景调用，dissolveTeam 内部会检查）
      await this.dissolveTeam(team.id, userId);
      return;
    }

    if (team.ownerId === userId) {
      // owner 退出：找下一个接手者
      const next =
        members.find((m) => m.role === 'admin' && m.userId !== userId) ||
        members.find((m) => m.userId !== userId);
      if (!next) throw new BadRequestException('无法确定新 owner');

      // 原子：更新团队 ownerId + 新 owner 角色 + 删除旧 owner 成员记录（无中间 demotion）
      await this.prisma.$transaction([
        this.prisma.team.update({ where: { id: team.id }, data: { ownerId: next.userId } }),
        this.prisma.teamMembership.update({
          where: { teamId_userId: { teamId: team.id, userId: next.userId } },
          data: { role: 'owner' },
        }),
        this.prisma.teamMembership.delete({
          where: { teamId_userId: { teamId: team.id, userId } },
        }),
      ]);
      return;
    }

    // 非 owner 退出，直接删除自身成员记录
    await this.prisma.teamMembership.delete({
      where: { teamId_userId: { teamId: team.id, userId } },
    });
  }

  generateInviteCode(): string {
    return randomBytes(12).toString('base64url');
  }
}
