import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  sanitize(user: any) {
    if (!user) return user;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
