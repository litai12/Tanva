import { Controller, Get, Param, NotFoundException, ForbiddenException, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TemplateService } from '../admin/services/template.service';

interface AuthenticatedUser {
  id?: string;
  sub?: string;
  role?: string;
}

@ApiTags('公共模板')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templateService: TemplateService) {}

  @Get('index')
  @ApiOperation({ summary: '获取公共模板索引（前端使用）' })
  async getTemplateIndex() {
    return this.templateService.getActiveTemplatesForFrontend();
  }

  @Get('categories')
  @ApiOperation({ summary: '获取公共模板分类（前端使用）' })
  async getCategories() {
    return this.templateService.getTemplateCategories();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取单个公共模板数据' })
  async getTemplate(
    @Param('id') id: string,
    @Request() req: FastifyRequest & { user: AuthenticatedUser },
  ) {
    const template = await this.templateService.getTemplateById(id);
    if (!template || !template.isActive) {
      throw new NotFoundException('模板不存在或已禁用');
    }
    const userId = req.user.id ?? req.user.sub;
    const role = typeof req.user.role === 'string' ? req.user.role.toLowerCase() : '';
    const isAdmin = role === 'admin' || role === 'normal_admin';
    if (!userId) {
      throw new ForbiddenException('请先登录后再使用模板');
    }
    if (!isAdmin) {
      const canUseTemplate = await this.templateService.canUserUseTemplate(id, userId);
      if (!canUseTemplate) {
        throw new ForbiddenException('该模板仅限 VIP 用户使用');
      }
    }
    return template.templateData;
  }
}



