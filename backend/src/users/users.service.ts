import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateGoogleApiKeyDto {
  googleCustomApiKey?: string | null;
  googleKeyMode?: 'official' | 'custom';
}

export interface UpdateProfileDto {
  name?: string;
  avatarUrl?: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    // 租户隔离后 email 非全局唯一；用 findFirst，租户扩展会自动补 tenantId 过滤
    return this.prisma.user.findFirst({ where: { email: email.toLowerCase() } });
  }

  async findByPhone(phone: string) {
    // 租户隔离后 phone 非全局唯一；用 findFirst，租户扩展会自动补 tenantId 过滤
    return this.prisma.user.findFirst({ where: { phone } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async touchLastLoginAt(userId: string, throttleMs = 60 * 1000) {
    const now = new Date();
    const threshold = new Date(now.getTime() - throttleMs);
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: threshold } }],
      },
      data: { lastLoginAt: now },
    });
  }

  async create(data: { phone: string; passwordHash: string; name?: string; email?: string }) {
    return this.prisma.user.create({
      data: {
        email: data.email ? data.email.toLowerCase() : null,
        passwordHash: data.passwordHash,
        name: data.name,
        phone: data.phone,
      },
      select: { id: true, email: true, phone: true, name: true, avatarUrl: true, role: true, status: true, createdAt: true },
    });
  }

  async updateGoogleApiKey(userId: string, dto: UpdateGoogleApiKeyDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        googleCustomApiKey: dto.googleCustomApiKey,
        googleKeyMode: dto.googleKeyMode ?? 'custom',
      },
      select: {
        id: true,
        googleCustomApiKey: true,
        googleKeyMode: true,
      },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: { name?: string; avatarUrl?: string | null } = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.avatarUrl !== undefined) {
      const trimmed = typeof dto.avatarUrl === 'string' ? dto.avatarUrl.trim() : '';
      if (
        trimmed &&
        !/^https?:\/\//i.test(trimmed) &&
        !/^\/[^/]/.test(trimmed) &&
        !/^(uploads|projects|templates)\//i.test(trimmed)
      ) {
        throw new BadRequestException('Invalid avatar URL');
      }
      data.avatarUrl = trimmed || null;
    }
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, phone: true, name: true, avatarUrl: true, role: true, status: true, createdAt: true },
    });
  }

  async getGoogleApiKey(userId: string): Promise<{ apiKey: string | null; mode: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        googleCustomApiKey: true,
        googleKeyMode: true,
      },
    });
    return {
      apiKey: user?.googleCustomApiKey ?? null,
      mode: user?.googleKeyMode ?? 'official',
    };
  }

  sanitize(user: any) {
    if (!user) return user;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
