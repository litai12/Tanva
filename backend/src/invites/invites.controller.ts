import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards, ForbiddenException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InvitesService } from './invites.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('invites')
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  private ensureAdmin(req: any) {
    if (!req?.user || req.user.role !== 'admin') {
      throw new ForbiddenException('仅管理员可访问');
    }
  }

  @Get('validate')
  async validate(@Query('code') code: string) {
    return this.invites.validate(code);
  }

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async generate(@Req() req: any, @Body() dto: { count?: number; maxUses?: number; prefix?: string; inviterUserId?: string; metadata?: any }) {
    this.ensureAdmin(req);
    const codes = await this.invites.generateBatch({
      count: dto.count ?? 1,
      maxUses: dto.maxUses,
      prefix: dto.prefix,
      inviterUserId: dto.inviterUserId,
      metadata: dto.metadata,
    });
    return { codes };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async list(@Req() req: any, @Query() query: { page?: number; pageSize?: number; status?: string; code?: string }) {
    this.ensureAdmin(req);
    return this.invites.list({
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      status: query.status,
      code: query.code,
    });
  }

  @Patch(':id/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async disable(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.invites.disable(id);
  }
}










