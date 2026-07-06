import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CollabEventBus } from '../team-collab/collab-event-bus.service';
import type {
  CollabEnvelope,
  CommentChangeAction,
  CommentChangedPayload,
} from '../team-collab/types';

const AUTHOR_SELECT = { id: true, name: true, avatarUrl: true } as const;

export interface CommentAuthorView {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface CommentView {
  id: string;
  threadId: string;
  author: CommentAuthorView;
  body: string;
  mentions: string[];
  imageUrls: string[];
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadView {
  id: string;
  nodeId: string | null;
  x: number | null;
  y: number | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: CommentAuthorView | null;
  createdById: string;
  createdAt: string;
  comments: CommentView[];
}

@Injectable()
export class CanvasCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: CollabEventBus,
  ) {}

  // ---- 读取 ----

  async listThreads(
    projectId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
    includeResolved: boolean,
  ): Promise<ThreadView[]> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    const threads = await this.prisma.canvasCommentThread.findMany({
      where: { projectId, ...(includeResolved ? {} : { resolved: false }) },
      orderBy: { createdAt: 'asc' },
      include: {
        resolvedBy: { select: AUTHOR_SELECT },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: AUTHOR_SELECT } },
        },
      },
    });
    return threads.map((t) => this.mapThread(t));
  }

  // ---- 写入 ----

  async createThread(
    projectId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
    dto: {
      nodeId?: string;
      x?: number;
      y?: number;
      body: string;
      mentions?: string[];
      imageUrls?: string[];
      connId?: string;
    },
  ): Promise<ThreadView> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    const imageUrls = this.normImages(dto.imageUrls);
    const body = this.normBody(dto.body, imageUrls.length > 0);
    const mentions = await this.sanitizeMentions(projectId, teamId, dto.mentions);
    const thread = await this.prisma.canvasCommentThread.create({
      data: {
        project: { connect: { id: projectId } },
        nodeId: dto.nodeId ?? null,
        x: typeof dto.x === 'number' ? dto.x : null,
        y: typeof dto.y === 'number' ? dto.y : null,
        createdById: userId,
        comments: {
          create: { authorId: userId, body, mentions, imageUrls },
        },
      },
      include: {
        resolvedBy: { select: AUTHOR_SELECT },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: AUTHOR_SELECT } },
        },
      },
    });
    const view = this.mapThread(thread);
    this.broadcast(projectId, {
      action: 'created',
      nodeId: thread.nodeId,
      threadId: thread.id,
      commentId: view.comments[0]?.id,
    });
    return view;
  }

  async addReply(
    projectId: string,
    threadId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
    dto: { body: string; mentions?: string[]; imageUrls?: string[]; connId?: string },
  ): Promise<CommentView> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    const thread = await this.getThreadInProject(projectId, threadId);
    const imageUrls = this.normImages(dto.imageUrls);
    const body = this.normBody(dto.body, imageUrls.length > 0);
    const mentions = await this.sanitizeMentions(projectId, teamId, dto.mentions);
    const comment = await this.prisma.canvasComment.create({
      data: { threadId, authorId: userId, body, mentions, imageUrls },
      include: { author: { select: AUTHOR_SELECT } },
    });
    // Figma 行为：对已解决线程回复会自动重开（避免并发下回复落进已解决线程而无人察觉）。
    if (thread.resolved) {
      await this.prisma.canvasCommentThread.update({
        where: { id: threadId },
        data: { resolved: false, resolvedAt: null, resolvedById: null },
      });
    }
    this.broadcast(projectId, {
      action: 'created',
      nodeId: thread.nodeId,
      threadId,
      commentId: comment.id,
    });
    return this.mapComment(comment);
  }

  async editComment(
    projectId: string,
    commentId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
    dto: { body: string; mentions?: string[]; imageUrls?: string[]; connId?: string },
  ): Promise<CommentView> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    const existing = await this.getCommentInProject(projectId, commentId);
    if (existing.authorId !== userId && !this.isSuperAdmin(role)) {
      throw new ForbiddenException('只能编辑自己的评论');
    }
    if (existing.deletedAt) throw new ForbiddenException('评论已删除');
    const imageUrls = this.normImages(dto.imageUrls);
    const body = this.normBody(dto.body, imageUrls.length > 0);
    const mentions = await this.sanitizeMentions(projectId, teamId, dto.mentions);
    const comment = await this.prisma.canvasComment.update({
      where: { id: commentId },
      data: { body, mentions, imageUrls },
      include: { author: { select: AUTHOR_SELECT } },
    });
    this.broadcast(projectId, {
      action: 'updated',
      nodeId: existing.thread.nodeId,
      threadId: existing.threadId,
      commentId,
    });
    return this.mapComment(comment);
  }

  async deleteComment(
    projectId: string,
    commentId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
  ): Promise<{ deleted: true }> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    const existing = await this.getCommentInProject(projectId, commentId);
    if (existing.authorId !== userId && !this.isSuperAdmin(role)) {
      throw new ForbiddenException('只能删除自己的评论');
    }
    if (!existing.deletedAt) {
      await this.prisma.canvasComment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      });
    }
    this.broadcast(projectId, {
      action: 'deleted',
      nodeId: existing.thread.nodeId,
      threadId: existing.threadId,
      commentId,
    });
    return { deleted: true };
  }

  async setResolved(
    projectId: string,
    threadId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
    resolved: boolean,
  ): Promise<ThreadView> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    await this.getThreadInProject(projectId, threadId);
    const thread = await this.prisma.canvasCommentThread.update({
      where: { id: threadId },
      data: {
        resolved,
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? userId : null,
      },
      include: {
        resolvedBy: { select: AUTHOR_SELECT },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: AUTHOR_SELECT } },
        },
      },
    });
    this.broadcast(projectId, {
      action: resolved ? 'resolved' : 'reopened',
      nodeId: thread.nodeId,
      threadId,
    });
    return this.mapThread(thread);
  }

  /** 删除整条评论线程（连带其 pin 与所有回复，硬删）。仅线程创建者或超管。 */
  async deleteThread(
    projectId: string,
    threadId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
  ): Promise<{ deleted: true }> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    const thread = await this.getThreadInProject(projectId, threadId);
    if (thread.createdById !== userId && !this.isSuperAdmin(role)) {
      throw new ForbiddenException('只能删除自己发起的评论');
    }
    await this.prisma.canvasCommentThread.delete({ where: { id: threadId } });
    this.broadcast(projectId, {
      action: 'deleted',
      nodeId: thread.nodeId,
      threadId,
    });
    return { deleted: true };
  }

  /** 移动 pin 到新画布坐标（任意有访问权成员可拖动）。 */
  async moveThread(
    projectId: string,
    threadId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
    x: number,
    y: number,
  ): Promise<ThreadView> {
    await this.assertProjectAccess(projectId, userId, teamId, role);
    await this.getThreadInProject(projectId, threadId);
    const thread = await this.prisma.canvasCommentThread.update({
      where: { id: threadId },
      data: { x, y },
      include: {
        resolvedBy: { select: AUTHOR_SELECT },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: AUTHOR_SELECT } },
        },
      },
    });
    this.broadcast(projectId, {
      action: 'moved',
      nodeId: thread.nodeId,
      threadId,
    });
    return this.mapThread(thread);
  }

  // ---- 内部 ----

  private broadcast(projectId: string, payload: CommentChangedPayload): void {
    // 不做按 connId 的回声抑制：连接 id 来自客户端不可信，且抑制收益仅为发起端少一次
    // debounce refetch（发起端已在本地乐观更新，再以服务端权威列表收敛，无副作用）。
    const env: CollabEnvelope<CommentChangedPayload> = {
      type: 'comment_changed',
      payload,
      ts: Date.now(),
    };
    // 评论已落库；广播仅为通知其他在线成员失效刷新。发布失败不影响接口成功。
    this.bus.publish(projectId, env).catch(() => undefined);
  }

  private normBody(body: string, allowEmpty = false): string {
    const t = (body ?? '').trim();
    // 允许「仅图片」评论：有图片时正文可为空。
    if (!t && !allowEmpty) throw new BadRequestException('评论内容不能为空');
    return t;
  }

  /** 收敛图片 URL：去空白、去重、仅保留 http(s)，上限 9 张。 */
  private normImages(imageUrls: string[] | undefined): string[] {
    if (!imageUrls || imageUrls.length === 0) return [];
    const cleaned = imageUrls
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter((u) => /^https?:\/\//i.test(u));
    return [...new Set(cleaned)].slice(0, 9);
  }

  private async getThreadInProject(projectId: string, threadId: string) {
    const thread = await this.prisma.canvasCommentThread.findUnique({
      where: { id: threadId },
    });
    if (!thread || thread.projectId !== projectId) {
      throw new NotFoundException('评论线程不存在');
    }
    return thread;
  }

  private async getCommentInProject(projectId: string, commentId: string) {
    const comment = await this.prisma.canvasComment.findUnique({
      where: { id: commentId },
      include: { thread: true },
    });
    if (!comment || comment.thread.projectId !== projectId) {
      throw new NotFoundException('评论不存在');
    }
    return comment;
  }

  /** 把前端传来的 mentions 收敛到「项目可访问用户」：团队成员 ∪ 项目所有者。 */
  private async sanitizeMentions(
    projectId: string,
    teamId: string | undefined,
    mentions: string[] | undefined,
  ): Promise<string[]> {
    if (!mentions || mentions.length === 0) return [];
    const unique = [...new Set(mentions)];
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    const allowed = new Set<string>();
    if (project) allowed.add(project.userId);
    if (teamId) {
      const members = await this.prisma.teamMembership.findMany({
        where: { teamId },
        select: { userId: true },
      });
      for (const m of members) allowed.add(m.userId);
    }
    return unique.filter((id) => allowed.has(id));
  }

  private mapThread(t: any): ThreadView {
    return {
      id: t.id,
      nodeId: t.nodeId ?? null,
      x: typeof t.x === 'number' ? t.x : null,
      y: typeof t.y === 'number' ? t.y : null,
      resolved: t.resolved,
      resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
      resolvedBy: t.resolvedBy
        ? {
            id: t.resolvedBy.id,
            name: t.resolvedBy.name ?? null,
            avatarUrl: t.resolvedBy.avatarUrl ?? null,
          }
        : null,
      createdById: t.createdById,
      createdAt: t.createdAt.toISOString(),
      comments: (t.comments ?? []).map((c: any) => this.mapComment(c)),
    };
  }

  private mapComment(c: any): CommentView {
    const deleted = Boolean(c.deletedAt);
    return {
      id: c.id,
      threadId: c.threadId,
      author: {
        id: c.author?.id ?? c.authorId,
        name: c.author?.name ?? null,
        avatarUrl: c.author?.avatarUrl ?? null,
      },
      body: deleted ? '' : c.body,
      mentions: deleted ? [] : c.mentions ?? [],
      imageUrls: deleted ? [] : c.imageUrls ?? [],
      deleted,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private isSuperAdmin(role?: string): boolean {
    const r = (role ?? '').toLowerCase();
    return r === 'admin' || r === 'superuser';
  }

  /** 项目访问校验：与 team-collab 控制器一致——所有者 / 超管 / 团队共享+成员。 */
  private async assertProjectAccess(
    projectId: string,
    userId: string,
    teamId: string | undefined,
    role: string | undefined,
  ): Promise<void> {
    if (this.isSuperAdmin(role)) return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId === userId) return;

    if (!teamId) throw new ForbiddenException('无权访问此项目');
    const share = await this.prisma.teamProjectShare.findUnique({
      where: { projectId_teamId: { projectId, teamId } },
    });
    if (!share) throw new ForbiddenException('项目未共享到此团队');
    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) throw new ForbiddenException('非团队成员');
  }
}
