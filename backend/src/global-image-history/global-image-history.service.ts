// Service for CRUD operations on global image history records.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGlobalImageHistoryDto, QueryGlobalImageHistoryDto } from './dto/global-image-history.dto';

@Injectable()
export class GlobalImageHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将异步视频的终态结果写入用户全局历史。
   *
   * 不能依赖浏览器轮询来做这件事：前端关闭、刷新或进程被回收后，任务仍会
   * 由后端补偿完成。taskId 是跨补偿轮询和查询接口共用的幂等键，避免同一视频
   * 在两条路径同时观察到成功时重复出现在素材库中。
   */
  async recordVideoForTask(params: {
    userId: string;
    taskId: string;
    videoUrl: string;
    thumbnailUrl?: string;
    prompt?: string;
    sourceType: string;
    sourceProjectId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const userId = params.userId.trim();
    const taskId = params.taskId.trim();
    const videoUrl = params.videoUrl.trim();
    if (!userId || !taskId || !videoUrl) return null;

    const existing = await this.prisma.globalImageHistory.findFirst({
      where: {
        userId,
        metadata: {
          path: ['taskId'],
          equals: taskId,
        },
      },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.globalImageHistory.create({
      data: {
        userId,
        imageUrl: videoUrl,
        prompt: params.prompt?.trim() || null,
        sourceType: params.sourceType,
        sourceProjectId: params.sourceProjectId?.trim() || null,
        metadata: {
          mediaType: 'video',
          videoUrl,
          ...(params.thumbnailUrl?.trim()
            ? { videoThumbnailUrl: params.thumbnailUrl.trim() }
            : {}),
          taskId,
          source: 'server-task-completion',
          ...(params.metadata ?? {}),
        },
      },
    });
  }

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
    const { limit = 20, cursor, sourceType, sourceProjectId, search, page } =
      query;

    const where: any = { userId };
    if (sourceType) {
      where.sourceType = sourceType;
    }
    if (sourceProjectId) {
      where.sourceProjectId = sourceProjectId;
    }
    if (typeof search === 'string' && search.trim()) {
      const keyword = search.trim();
      where.OR = [
        {
          prompt: {
            contains: keyword,
            mode: 'insensitive',
          },
        },
        {
          sourceProjectName: {
            contains: keyword,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (typeof page === 'number' && Number.isFinite(page) && page >= 1) {
      const totalCount = await this.prisma.globalImageHistory.count({ where });
      const totalPages =
        totalCount > 0 ? Math.ceil(totalCount / limit) : 1;
      const safePage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
      const skip = (safePage - 1) * limit;

      const items = await this.prisma.globalImageHistory.findMany({
        where,
        take: limit,
        skip,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      return {
        items,
        nextCursor: undefined,
        hasMore: safePage < totalPages,
        totalCount,
        totalPages,
        page: safePage,
      };
    }

    const items = await this.prisma.globalImageHistory.findMany({
      where,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
