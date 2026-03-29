import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeDesignJson } from '../utils/designJsonSanitizer';

type UserTemplateListItem = {
  id: string;
  name: string;
  category?: string | null;
  tags: string[];
  thumbnail?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserTemplatePayload = {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  tags: string[];
  thumbnail?: string | null;
  templateData: Record<string, unknown>;
};

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const toNullableString = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return toNonEmptyString(value) ?? null;
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    const tag = toNonEmptyString(item);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
};

@Injectable()
export class UserTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<UserTemplateListItem[]> {
    return this.prisma.userTemplate.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        category: true,
        tags: true,
        thumbnail: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async get(userId: string, id: string): Promise<Record<string, unknown>> {
    const template = await this.prisma.userTemplate.findFirst({
      where: { userId, id },
    });
    if (!template) {
      throw new NotFoundException('模板不存在');
    }

    const data =
      template.templateData && typeof template.templateData === 'object' && !Array.isArray(template.templateData)
        ? ({ ...(template.templateData as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    data.id = template.id;
    data.name = template.name;
    if (template.category) data.category = template.category;
    if (template.description) data.description = template.description;
    if (Array.isArray(template.tags)) data.tags = template.tags;
    if (template.thumbnail) data.thumbnail = template.thumbnail;
    data.createdAt = template.createdAt.toISOString();
    data.updatedAt = template.updatedAt.toISOString();
    return data;
  }

  async upsert(userId: string, templateRaw: Record<string, unknown>): Promise<UserTemplateListItem> {
    let payload = this.sanitizeTemplatePayload(templateRaw);

    const existingOwner = await this.prisma.userTemplate.findUnique({
      where: { id: payload.id },
      select: { userId: true },
    });
    if (existingOwner && existingOwner.userId !== userId) {
      payload = {
        ...payload,
        id: `tpl_${randomUUID()}`,
      };
      payload.templateData = {
        ...payload.templateData,
        id: payload.id,
      };
    }

    const existing = await this.prisma.userTemplate.findFirst({
      where: { userId, id: payload.id },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.userTemplate.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          category: payload.category,
          description: payload.description,
          tags: payload.tags,
          thumbnail: payload.thumbnail,
          templateData: payload.templateData as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          name: true,
          category: true,
          tags: true,
          thumbnail: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    return this.prisma.userTemplate.create({
      data: {
        id: payload.id,
        userId,
        name: payload.name,
        category: payload.category,
        description: payload.description,
        tags: payload.tags,
        thumbnail: payload.thumbnail,
        templateData: payload.templateData as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        name: true,
        category: true,
        tags: true,
        thumbnail: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.userTemplate.findFirst({
      where: { userId, id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('模板不存在');
    }
    await this.prisma.userTemplate.delete({ where: { id } });
    return { ok: true };
  }

  private sanitizeTemplatePayload(input: Record<string, unknown>): UserTemplatePayload {
    const id = toNonEmptyString(input.id) || `tpl_${randomUUID()}`;
    const name = toNonEmptyString(input.name) || `模板_${Date.now()}`;
    const category = toNullableString(input.category);
    const description = toNullableString(input.description);
    const tags = normalizeTags(input.tags);
    const thumbnailRaw = toNullableString(input.thumbnail);
    const sanitizedThumbnail = thumbnailRaw === undefined ? undefined : sanitizeDesignJson(thumbnailRaw);
    const thumbnail = typeof sanitizedThumbnail === 'string' ? sanitizedThumbnail : null;

    const asObject = sanitizeDesignJson(input);
    if (!asObject || typeof asObject !== 'object' || Array.isArray(asObject)) {
      throw new BadRequestException('template 必须是对象');
    }
    const templateData = {
      ...(asObject as Record<string, unknown>),
      id,
      name,
      category: category ?? undefined,
      description: description ?? undefined,
      tags,
      thumbnail: thumbnail ?? undefined,
    };
    const sanitizedTemplateData = sanitizeDesignJson(templateData);
    if (!sanitizedTemplateData || typeof sanitizedTemplateData !== 'object' || Array.isArray(sanitizedTemplateData)) {
      throw new BadRequestException('templateData 非法');
    }

    return {
      id,
      name,
      category: category ?? null,
      description: description ?? null,
      tags,
      thumbnail,
      templateData: sanitizedTemplateData as Record<string, unknown>,
    };
  }
}
