import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto, TemplateQueryDto } from '../dto/template.dto';
import { OssService } from '../../oss/oss.service';
import { sanitizeDesignJson } from '../../utils/designJsonSanitizer';

const sanitizeNullableString = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const sanitized = sanitizeDesignJson(value);
  return typeof sanitized === 'string' ? sanitized : null;
};

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService, private readonly oss: OssService) {}

  async createTemplate(dto: CreateTemplateDto, createdBy?: string) {
    let templateData = dto.templateData;
    if (!templateData && dto.templateJsonKey) {
      // 从 OSS 拉取 JSON 内容
      const json = await this.oss.getJSON(dto.templateJsonKey);
      if (!json) {
        throw new Error(`无法从 OSS 读取模板 JSON 文件: ${dto.templateJsonKey}`);
      }
      templateData = json;
    }
    if (!templateData || (typeof templateData === 'object' && Object.keys(templateData).length === 0)) {
      throw new Error('模板数据不能为空');
    }
    templateData = sanitizeDesignJson(templateData);

    return this.prisma.publicTemplate.create({
      data: {
        name: dto.name,
        category: dto.category,
        description: dto.description,
        tags: dto.tags || [],
        thumbnail: sanitizeNullableString(dto.thumbnail),
        thumbnailSmall: sanitizeNullableString((dto as any).thumbnailSmall),
        templateData,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdBy,
        updatedBy: createdBy,
      },
    });
  }

  async getTemplates(query: TemplateQueryDto) {
    const { page = 1, pageSize = 10, category, isActive, search } = query;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (category) {
      where.category = category;
    }

    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [search] } },
      ];
    }

    const [templates, total] = await Promise.all([
      this.prisma.publicTemplate.findMany({
        where,
        orderBy: [
          { updatedAt: 'desc' },
        ],
        skip,
        take: pageSize,
      }),
      this.prisma.publicTemplate.count({ where }),
    ]);

    return {
      items: templates,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getTemplateById(id: string) {
    const template = await this.prisma.publicTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('模板不存在');
    }

    return template;
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto, updatedBy?: string) {
    const template = await this.getTemplateById(id);
    let resolvedTemplateData = dto.templateData;
    if (resolvedTemplateData === undefined && (dto as any).templateJsonKey) {
      const json = await this.oss.getJSON((dto as any).templateJsonKey);
      resolvedTemplateData = json ?? undefined;
    }
    if (resolvedTemplateData !== undefined) {
      resolvedTemplateData = sanitizeDesignJson(resolvedTemplateData);
    }

    return this.prisma.publicTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.thumbnail !== undefined && { thumbnail: sanitizeNullableString(dto.thumbnail) }),
        ...((dto as any).thumbnailSmall !== undefined && { thumbnailSmall: sanitizeNullableString((dto as any).thumbnailSmall) }),
        ...(resolvedTemplateData !== undefined && { templateData: resolvedTemplateData }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        updatedBy,
      },
    });
  }

  async deleteTemplate(id: string) {
    const template = await this.getTemplateById(id);

    await this.prisma.publicTemplate.delete({
      where: { id },
    });

    return { success: true };
  }

  async getTemplateCategories() {
    // 优先从系统设置中读取持久化的分类列表
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'template_categories' } });
    if (setting && setting.value) {
      try {
        const list = JSON.parse(setting.value);
        if (Array.isArray(list)) {
          const filtered = list.filter(Boolean);
          // 将"其他"分类固定在末尾
          const other = filtered.filter((c: string) => c === '其他');
          const rest = filtered.filter((c: string) => c !== '其他').sort();
          return [...rest, ...other];
        }
      } catch (e) {
        // ignore parse error and fallback
      }
    }

    // fallback: 从现有模板中收集分类
    const categories = await this.prisma.publicTemplate.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ['category'],
    });

    const cats = categories.map(c => c.category).filter(Boolean);
    // 将"其他"分类固定在末尾
    const other = cats.filter(c => c === '其他');
    const rest = cats.filter(c => c !== '其他').sort();
    return [...rest, ...other];
  }

  async getActiveTemplatesForFrontend() {
    const templates = await this.prisma.publicTemplate.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        tags: true,
        thumbnail: true,
        thumbnailSmall: true,
      },
      orderBy: [
        { createdAt: 'desc' },
      ],
    });

    return templates.map(template => ({
      id: template.id,
      name: template.name,
      category: template.category,
      description: template.description,
      tags: template.tags,
      thumbnail: template.thumbnail,
      thumbnailSmall: template.thumbnailSmall,
    }));
  }
}
