import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

const DEFAULT_CODE_LENGTH = 8;

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  private generateCode(len = DEFAULT_CODE_LENGTH) {
    // 使用 base36 生成短码并转大写
    return randomBytes(Math.ceil(len))
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, len)
      .toUpperCase();
  }

  async generateBatch(options: {
    count: number;
    maxUses?: number;
    prefix?: string;
    inviterUserId?: string;
    metadata?: any;
  }) {
    const count = Math.min(Math.max(options.count || 1, 1), 500);
    const maxUses = options.maxUses && options.maxUses > 0 ? options.maxUses : 1;
    const prefix = (options.prefix || '').toUpperCase();

    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(`${prefix}${this.generateCode(DEFAULT_CODE_LENGTH)}`);
    }

    await this.prisma.invitationCode.createMany({
      data: codes.map((code) => ({
        code,
        maxUses,
        inviterUserId: options.inviterUserId,
        metadata: options.metadata,
      })),
      skipDuplicates: true,
    });

    return codes;
  }

  async list(options: { page?: number; pageSize?: number; status?: string; code?: string } = {}) {
    const page = Math.max(options.page || 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize || 20, 1), 200);
    const where: any = {};
    if (options.status) where.status = options.status;
    if (options.code) where.code = { contains: options.code, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.invitationCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          redemptions: {
            orderBy: { createdAt: 'desc' },
            select: {
              inviteeUserId: true,
              inviterUserId: true,
              createdAt: true,
              invitee: {
                select: { id: true, name: true, phone: true, email: true },
              },
            },
          },
        },
      }),
      this.prisma.invitationCode.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async validate(code: string) {
    if (!code) throw new BadRequestException('缺少邀请码');
    const invite = await this.prisma.invitationCode.findUnique({ where: { code } });
    if (!invite) throw new NotFoundException('邀请码不存在');
    const remaining = Math.max(invite.maxUses - invite.usedCount, 0);
    const usable = invite.status === 'active' && remaining > 0;
    return {
      usable,
      status: invite.status,
      remaining,
      invite,
    };
  }

  async disable(id: string) {
    const invite = await this.prisma.invitationCode.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('邀请码不存在');
    return this.prisma.invitationCode.update({
      where: { id },
      data: { status: 'disabled' },
    });
  }
}

