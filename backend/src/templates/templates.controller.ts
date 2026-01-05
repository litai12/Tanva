import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TemplateService } from '../admin/services/template.service';

@ApiTags('公共模板')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templateService: TemplateService) {}

  @Get('index')
  @ApiOperation({ summary: '获取公共模板索引（前端使用）' })
  async getTemplateIndex() {
    return this.templateService.getActiveTemplatesForFrontend();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个公共模板数据' })
  async getTemplate(@Param('id') id: string) {
    const template = await this.templateService.getTemplateById(id);
    if (!template || !template.isActive) {
      throw new NotFoundException('模板不存在或已禁用');
    }
    return template.templateData;
  }

  @Get('categories')
  @ApiOperation({ summary: '获取公共模板分类（前端使用）' })
  async getCategories() {
    return this.templateService.getTemplateCategories();
  }
}




