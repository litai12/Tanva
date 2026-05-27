import {
  Injectable, ForbiddenException, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from './team-core.service';
import { InviteMemberDto } from './dto/invite-member.dto';

@Injectable()
export class TeamInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamCore: TeamCoreService,
  ) {}

  async createInvite(teamId: string, inviterUserId: string, dto: InviteMemberDto) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new ForbiddenException('个人团队不可邀请成员');
    await this.teamCore.assertRole(teamId, inviterUserId, ['owner', 'admin']);

    const code = this.teamCore.generateInviteCode();
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 86400_000)
      : null;

    return this.prisma.teamInvite.create({
      data: {
        teamId,
        code,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        inviterUserId,
        expiresAt,
      },
    });
  }

  async listInvites(teamId: string, requestingUserId: string) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    return this.prisma.teamInvite.findMany({
      where: { teamId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(inviteId: string, teamId: string, requestingUserId: string) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    // 确保 invite 属于该 team（防止跨团队撤销）
    const invite = await this.prisma.teamInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.teamId !== teamId) throw new NotFoundException('邀请不存在');
    return this.prisma.teamInvite.update({
      where: { id: inviteId },
      data: { status: 'revoked' },
    });
  }

  async getInviteInfo(code: string) {
    const invite = await this.prisma.teamInvite.findUnique({
      where: { code },
      include: { team: { select: { id: true, name: true } } },
    });
    if (!invite) throw new NotFoundException('邀请码不存在');
    if (invite.status !== 'pending') throw new BadRequestException('邀请码已失效');
    if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestException('邀请码已过期');
    return { teamId: invite.teamId, teamName: invite.team.name, expiresAt: invite.expiresAt };
  }

  async acceptInvite(code: string, acceptingUserId: string) {
    const invite = await this.prisma.teamInvite.findUnique({ where: { code } });
    if (!invite) throw new NotFoundException('邀请码不存在');
    if (invite.status !== 'pending') throw new BadRequestException('邀请码已失效');
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      await this.prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'expired' } });
      throw new BadRequestException('邀请码已过期');
    }

    // 检查是否已是成员（事务外快速检查，事务内再次确认）
    const existing = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId: invite.teamId, userId: acceptingUserId } },
    });
    if (existing) throw new BadRequestException('已是团队成员');

    // 漏洞 7 修复：在同一事务内原子检查座位上限，防止并发超额
    // 订阅信息在事务内读取，避免 TOCTOU
    await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.findUniqueOrThrow({
        where: { id: invite.teamId },
        include: { subscriptions: { where: { status: 'active' }, take: 1 } },
      });
      const memberCount = await tx.teamMembership.count({
        where: { teamId: invite.teamId },
      });
      const seatLimit = team.subscriptions[0]?.seatCount ?? team.maxSeats;
      if (memberCount >= seatLimit) throw new BadRequestException('团队座位已满');

      await tx.teamMembership.create({
        data: { teamId: invite.teamId, userId: acceptingUserId, role: 'member' },
      });
      await tx.teamInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted', acceptedUserId: acceptingUserId, acceptedAt: new Date() },
      });
    });

    return { teamId: invite.teamId, message: '加入成功' };
  }
}
