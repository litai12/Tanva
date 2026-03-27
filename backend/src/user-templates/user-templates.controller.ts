import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UpsertUserTemplateDto } from './dto/upsert-user-template.dto';
import { UserTemplatesService } from './user-templates.service';

@ApiTags('user-templates')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('user-templates')
export class UserTemplatesController {
  constructor(private readonly userTemplates: UserTemplatesService) {}

  @Get()
  @ApiOperation({ summary: '获取当前用户模板列表' })
  async list(@Req() req: any) {
    return this.userTemplates.list(req.user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取当前用户单个模板详情' })
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.userTemplates.get(req.user.sub, id);
  }

  @Post()
  @ApiOperation({ summary: '创建或更新当前用户模板' })
  async upsert(@Req() req: any, @Body() dto: UpsertUserTemplateDto) {
    return this.userTemplates.upsert(req.user.sub, dto.template);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除当前用户模板' })
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.userTemplates.remove(req.user.sub, id);
  }
}

