import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('db')
  async db() {
    try {
      // Simple connectivity probe
      await this.prisma.$queryRaw`SELECT 1 as ok`;
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (e: any) {
      return { status: 'error', message: e?.message || String(e) };
    }
  }
}
