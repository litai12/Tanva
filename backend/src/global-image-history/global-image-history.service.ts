import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGlobalImageHistoryDto, QueryGlobalImageHistoryDto } from './dto/global-image-history.dto';

@Injectable()
export class GlobalImageHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateGlobalImageHistoryDto) {
    return this.prisma.globalImageHistory.create({
      data: {
        userId,
        imageUrl: dto.imageUrl,
        prompt: dto.prompt,
        sourceType: dto.sourceType,
        sourceProjectId: dto.sourceProjectId,
        sourceProjectName: dto.sourceProjectName,
        metadata: dto.metadata,
      },
    });
  }

  async list(userId: string, query: QueryGlobalImageHistoryDto) {
    const { limit = 20, cursor, sourceType } = query;

    const where: any = { userId };
    if (sourceType) {
      where.sourceType = sourceType;
    }

    const items = await this.prisma.globalImageHistory.findMany({
      where,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    let nextCursor: string | undefined;
    if (items.length > limit) {
      const nextItem = items.pop();
      nextCursor = nextItem?.id;
    }

    return {
      items,
      nextCursor,
      hasMore: !!nextCursor,
    };
  }

  async getOne(userId: string, id: string) {
    return this.prisma.globalImageHistory.findFirst({
      where: { id, userId },
    });
  }

  async delete(userId: string, id: string) {
    const item = await this.prisma.globalImageHistory.findFirst({
      where: { id, userId },
    });
    if (!item) {
      return { success: false, message: '记录不存在' };
    }
    await this.prisma.globalImageHistory.delete({ where: { id } });
    return { success: true };
  }

  async getCount(userId: string) {
    return this.prisma.globalImageHistory.count({ where: { userId } });
  }
}
