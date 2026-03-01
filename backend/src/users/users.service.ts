import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateGoogleApiKeyDto {
  googleCustomApiKey?: string | null;
  googleKeyMode?: 'official' | 'custom';
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
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
