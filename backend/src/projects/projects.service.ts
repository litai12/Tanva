import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CanvasSseManager } from '../team-collab/canvas-sse.manager';
import { CollabEventBus, channelForTeam } from '../team-collab/collab-event-bus.service';
import type { CollabEnvelope, TeamProjectsChangeAction, TeamProjectsChangedPayload } from '../team-collab/types';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { sanitizeDesignJson, dropGhostFlowNodes } from '../utils/designJsonSanitizer';
import { mergeProjectSnapshots } from './merge-project-snapshots';

@Injectable()
export class ProjectsService {
  private static readonly SLOW_SAVE_LOG_MS = Number(process.env.PROJECT_SAVE_SLOW_LOG_MS || 2000);
  private static readonly LARGE_SAVE_LOG_BYTES = Number(process.env.PROJECT_SAVE_LARGE_LOG_BYTES || 2 * 1024 * 1024);

  private readonly workflowHistoryRetentionDays = 7;
  private thumbnailColumnChecked = false;
  private thumbnailColumnAvailable = false;
  private readonly projectSaveQueue = new Map<string, Promise<void>>();
  private readonly projectContentFingerprint = new Map<
    string,
    { hash: string; version: number; touchedAt: number }
  >();
  private readonly projectContentFingerprintTtlMs = 30 * 60 * 1000;
  private readonly projectContentFingerprintMaxEntries = 1000;

  constructor(
    private prisma: PrismaService,
    private oss: OssService,
    @Optional() private readonly canvasSse?: CanvasSseManager,
    @Optional() private readonly bus?: CollabEventBus,
  ) {}

  /**
   * 向某团队频道广播「团队项目列表已变更」失效事件，让该团队其他在线成员重新拉取列表。
   * best-effort：未注入 bus 或发布失败均静默，绝不影响项目增删改本身的成功。
   */
  private broadcastTeamProjectsChanged(
    teamId: string,
    action: TeamProjectsChangeAction,
    projectId: string,
    actorUserId?: string | null,
  ): void {
    if (!this.bus) return;
    const env: CollabEnvelope<TeamProjectsChangedPayload> = {
      type: 'team_projects_changed',
      payload: { teamId, action, projectId, actorUserId: actorUserId ?? null },
      ts: Date.now(),
      senderUserId: actorUserId ?? undefined,
    };
    this.bus.publishTo(channelForTeam(teamId), env).catch(() => undefined);
  }

  /** 对一个项目当前共享到的所有团队广播列表变更（用于重命名/删除等无显式 teamId 的场景）。 */
  private async broadcastForProjectTeams(
    projectId: string,
    action: TeamProjectsChangeAction,
    actorUserId?: string | null,
  ): Promise<void> {
    if (!this.bus) return;
    try {
      const shares = await this.prisma.teamProjectShare.findMany({
        where: { projectId },
        select: { teamId: true },
      });
      for (const s of shares) {
        this.broadcastTeamProjectsChanged(s.teamId, action, projectId, actorUserId);
      }
    } catch {
      // best-effort，忽略
    }
  }

  private readonly projectMetadataSelect = {
    id: true,
    userId: true,
    name: true,
    ossPrefix: true,
    mainKey: true,
    thumbnailUrl: true,
    contentVersion: true,
    createdAt: true,
    updatedAt: true,
  };

  async list(userId: string) {
    await this.ensureThumbnailColumn();
    const projects = await this.prisma.project.findMany({
      where: { userId, teamShares: { none: {} } },
      orderBy: { createdAt: 'desc' },
      select: this.projectMetadataSelect,
    });
    return projects.map((p) => ({
      ...p,
      mainUrl: p.mainKey ? this.oss.publicUrl(p.mainKey) : undefined,
      thumbnailUrl: this.extractThumbnail(p) || undefined,
    }));
  }

  async create(userId: string, name?: string, teamId?: string) {
    await this.ensureThumbnailColumn();
    const project = await this.prisma.project.create({ data: { userId, name: name || '未命名项目', ossPrefix: '', mainKey: '' } });
    const prefix = `projects/${userId}/${project.id}/`;
    const mainKey = `${prefix}project.json`;
    const payload = {
      id: project.id,
      name: project.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      canvas: { width: 1920, height: 1080, zoom: 1, background: '#ffffff' },
      layers: [],
      assets: [],
    };
    try {
      await this.oss.putJSON(mainKey, payload);
    } catch (e) {
      // 不中断项目创建，记录日志即可（开发环境未配置 OSS 时）
      // eslint-disable-next-line no-console
      console.warn('OSS putJSON failed, project created without file:', e);
    }
    const baseUpdate: Prisma.ProjectUpdateInput = { ossPrefix: prefix, mainKey };
    let updated: any;
    try {
      updated = await this.prisma.project.update({
        where: { id: project.id },
        data: this.withOptionalContentJson(baseUpdate, payload),
      });
    } catch (e) {
      // 兼容未迁移数据库环境：如果出现未知字段错误，退回不写 contentJson
      // eslint-disable-next-line no-console
      console.warn('DB update with contentJson failed, falling back:', e);
      updated = await this.prisma.project.update({ where: { id: project.id }, data: { ossPrefix: prefix, mainKey } });
    }

    // 团队上下文：在非个人团队内创建的项目立即共享给该团队，
    // 实现团队与团队（含个人工作区）之间的项目数据隔离。
    if (teamId) {
      const team = await this.prisma.team.findUnique({
        where: { id: teamId },
        select: { isPersonal: true },
      });
      if (team && !team.isPersonal) {
        const membership = await this.prisma.teamMembership.findUnique({
          where: { teamId_userId: { teamId, userId } },
        });
        if (membership) {
          await this.prisma.teamProjectShare.create({
            data: { projectId: project.id, teamId, access: 'edit', sharedByUserId: userId },
          });
          // 新建团队项目：通知该团队其他在线成员刷新项目列表（实时同步，免手动刷新）。
          this.broadcastTeamProjectsChanged(teamId, 'created', project.id, userId);
        }
      }
    }

    return { ...updated, mainUrl: this.oss.publicUrl(mainKey), thumbnailUrl: this.extractThumbnail(updated) || undefined };
  }

  async get(userId: string, id: string, role?: string) {
    await this.ensureThumbnailColumn();
    const p = await this.prisma.project.findUnique({
      where: { id },
      select: {
        ...this.projectMetadataSelect,
        contentJson: !(await this.supportsThumbnailColumn()), // 只有在不支持 thumbnailUrl 列时才查询 contentJson
      },
    });
    if (!p) throw new NotFoundException('项目不存在');
    if (!this.isSuperAdmin(role) && p.userId !== userId) await this.assertTeamProjectAccess(userId, id);
    // 解析该项目对当前用户而言所属的团队（被共享到的、用户为成员的团队）。
    // 前端据此在通过 URL 打开项目时把团队上下文切到项目所属团队，
    // 避免复制/重开团队项目链接时顶部仍停留在个人身份/余额。null = 个人项目。
    const teamShare = await this.prisma.teamProjectShare.findFirst({
      where: { projectId: id, team: { memberships: { some: { userId } } } },
      select: { teamId: true },
    });
    return {
      ...p,
      teamId: teamShare?.teamId ?? null,
      mainUrl: this.oss.publicUrl(p.mainKey),
      thumbnailUrl: this.extractThumbnail(p) || undefined,
    };
  }

  async update(userId: string, id: string, payload: { name?: string; thumbnailUrl?: string | null }, role?: string) {
    await this.ensureThumbnailColumn();
    const supportsThumbnailColumn = await this.supportsThumbnailColumn();
    const p = await this.prisma.project.findUnique({
      where: { id },
      select: {
        ...this.projectMetadataSelect,
        contentJson: !supportsThumbnailColumn, // 只有在不支持 thumbnailUrl 列时才查询 contentJson
      },
    });
    if (!p) throw new NotFoundException('项目不存在');
    if (!this.isSuperAdmin(role) && p.userId !== userId) await this.assertTeamProjectAccess(userId, id);

    const data: (Prisma.ProjectUpdateInput & Record<string, any>) = {};
    const nextName = payload.name !== undefined ? (payload.name || '未命名项目') : undefined;
    // 仅在「名称真的变了」时广播，避免缩略图自动保存(thumbnailUrl)频繁触发列表刷新。
    const nameChanged = nextName !== undefined && nextName !== p.name;
    if (payload.name !== undefined) {
      data.name = nextName as string;
    }
    if (payload.thumbnailUrl !== undefined) {
      if (supportsThumbnailColumn) {
        data.thumbnailUrl = payload.thumbnailUrl || null;
      } else {
        data.contentJson = this.patchContentThumbnail(
          (p as any).contentJson,
          payload.thumbnailUrl || null
        ) as Prisma.InputJsonValue;
      }
    }

    if (Object.keys(data).length === 0) {
      return { ...p, mainUrl: this.oss.publicUrl(p.mainKey), thumbnailUrl: this.extractThumbnail(p) || undefined };
    }

    try {
      const updated = await this.prisma.project.update({ where: { id }, data });
      if (nameChanged) void this.broadcastForProjectTeams(id, 'renamed', userId);
      return { ...updated, mainUrl: this.oss.publicUrl(updated.mainKey), thumbnailUrl: this.extractThumbnail(updated) || undefined };
    } catch (error: any) {
      if (this.shouldDowngradeThumbnailColumn(error)) {
        await this.disableThumbnailColumn();
        const downgraded = await this.prisma.project.update({
          where: { id },
          data: {
            ...(payload.name !== undefined ? { name: payload.name || '未命名项目' } : {}),
            contentJson: this.patchContentThumbnail(
              (p as any).contentJson,
              payload.thumbnailUrl || null
            ) as Prisma.InputJsonValue,
          },
        });
        if (nameChanged) void this.broadcastForProjectTeams(id, 'renamed', userId);
        return { ...downgraded, mainUrl: this.oss.publicUrl(downgraded.mainKey), thumbnailUrl: this.extractThumbnail(downgraded) || undefined };
      }
      throw error;
    }
  }

  async remove(userId: string, id: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) {
      // 非创建者：若项目共享到了某团队且当前用户是该团队 owner/admin，则允许删除
      const manageable = await this.prisma.teamProjectShare.findFirst({
        where: {
          projectId: id,
          team: { memberships: { some: { userId, role: { in: ['owner', 'admin'] } } } },
        },
      });
      if (!manageable) throw new NotFoundException('项目不存在');
    }
    // 删除会级联清掉 teamProjectShare，故先取出受影响团队，删除后再广播。
    const affectedTeams = await this.prisma.teamProjectShare.findMany({
      where: { projectId: id },
      select: { teamId: true },
    });
    await this.prisma.project.delete({ where: { id } });
    for (const s of affectedTeams) {
      this.broadcastTeamProjectsChanged(s.teamId, 'deleted', id, userId);
    }
    return { ok: true };
  }

  async getContent(userId: string, id: string, role?: string) {
    await this.ensureThumbnailColumn();
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');
    if (!this.isSuperAdmin(role) && project.userId !== userId) await this.assertTeamProjectAccess(userId, id);

    if (!project.mainKey) {
      return {
        content: dropGhostFlowNodes(sanitizeDesignJson((project as any).contentJson || null)),
        version: project.contentVersion,
        updatedAt: project.updatedAt,
      };
    }

    try {
      const content = await this.oss.getJSON(project.mainKey);
      const resolved = dropGhostFlowNodes(
        sanitizeDesignJson(content ?? ((project as any).contentJson || null)),
      );
      return {
        content: resolved,
        version: project.contentVersion ?? 1,
        updatedAt: project.updatedAt,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OSS getJSON failed, returning null content:', err);
      return {
        content: dropGhostFlowNodes(sanitizeDesignJson((project as any).contentJson || null)),
        version: project.contentVersion ?? 1,
        updatedAt: project.updatedAt,
      };
    }
  }

  async updateContent(
    userId: string,
    id: string,
    content: unknown,
    version?: number,
    options?: {
      createWorkflowHistory?: boolean;
      workflowHistoryMeta?: {
        restoredFromUpdatedAt?: string;
        restoredFromVersion?: number;
      };
    },
    role?: string
  ) {
    return this.runProjectSaveSerialized(id, async () => {
      const saveStartedAt = Date.now();
      const timings: Record<string, number> = {};
      const timeStep = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
        const startedAt = Date.now();
        try {
          return await task();
        } finally {
          timings[name] = Date.now() - startedAt;
        }
      };

      await this.ensureThumbnailColumn();
      const supportsThumbnailColumn = await this.supportsThumbnailColumn();
      const project = await this.prisma.project.findUnique({
        where: { id },
        select: {
          ...this.projectMetadataSelect,
          contentJson: !supportsThumbnailColumn,
        },
      });
      if (!project) throw new NotFoundException('项目不存在');
      const isSuperAdmin = this.isSuperAdmin(role);
      if (!isSuperAdmin && project.userId !== userId) await this.assertTeamProjectAccess(userId, id);
      // 超管保存他人项目时，工作流历史归属项目所有者，保证 owner 与超管都能查到。
      const historyUserId = isSuperAdmin ? project.userId : userId;
      const prefix = project.ossPrefix || `projects/${project.userId}/${project.id}/`;
      const mainKey = project.mainKey || `${prefix}project.json`;
      const sanitizeStartedAt = Date.now();
      let sanitizedContent = dropGhostFlowNodes(sanitizeDesignJson(content));
      const contentFingerprint = this.hashProjectContent(sanitizedContent);
      timings.sanitizeAndHashMs = Date.now() - sanitizeStartedAt;
      let contentHash = contentFingerprint.hash;
      let contentBytes = contentFingerprint.bytes;
      const cachedFingerprint = this.projectContentFingerprint.get(id);

      // Skip duplicate saves that would write exactly the same payload again.
      if (cachedFingerprint?.hash === contentHash) {
        const currentVersion = project.contentVersion ?? cachedFingerprint.version;
        this.rememberProjectContentFingerprint(id, contentHash, currentVersion);
        this.logProjectSaveIfHot({
          projectId: id,
          userId,
          contentBytes,
          durationMs: Date.now() - saveStartedAt,
          timings,
          version: currentVersion,
          duplicate: true,
        });
        return {
          version: currentVersion,
          updatedAt: project.updatedAt,
          mainUrl: project.mainKey ? this.oss.publicUrl(project.mainKey) : undefined,
          thumbnailUrl: this.extractThumbnail(project) || undefined,
        };
      }

      // 乐观并发：客户端携带其加载时的 baseVersion(version)。若已落后于服务端当前版本，
      // 说明期间有他人(协作)/他端保存过。此前是拒绝(version_conflict)，现改为「取并集」：
      // 读取远端当前快照，与本次提交(incoming = 当前用户)合并，同 id 冲突以 incoming 为准，
      // remote-only 追加，谁的新增都不丢。合并后照常落盘，并在返回里带 merged/content 供前端 adopt。
      const currentContentVersion = project.contentVersion ?? 0;
      let mergedFromConflict = false;
      if (typeof version === 'number' && version > 0 && version < currentContentVersion) {
        let remoteContent: any = null;
        try {
          remoteContent = supportsThumbnailColumn
            ? await timeStep('conflictReadRemoteMs', () => this.oss.getJSON(mainKey))
            : ((project as any).contentJson ?? null);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[merge] 读取远端快照失败，回退为仅用当前用户内容:', err);
        }
        if (remoteContent) {
          sanitizedContent = dropGhostFlowNodes(
            sanitizeDesignJson(mergeProjectSnapshots(remoteContent, sanitizedContent)),
          );
          const mergedFingerprint = this.hashProjectContent(sanitizedContent);
          contentHash = mergedFingerprint.hash;
          contentBytes = mergedFingerprint.bytes;
          mergedFromConflict = true;
        }
      }

      try {
        await timeStep('ossPutMs', () => this.oss.putJSON(mainKey, sanitizedContent));
      } catch (err) {
        // 在开发环境中，OSS错误不应该阻止项目内容更新
        // eslint-disable-next-line no-console
        console.warn('OSS putJSON failed, continuing with database update:', err);
        // 不抛出错误，继续更新数据库
      }

      const newVersion = (project.contentVersion ?? 0) + 1;
      const baseUpdate: Prisma.ProjectUpdateInput = {
        ossPrefix: prefix,
        mainKey,
        contentVersion: newVersion,
      };
      const contentForStorage =
        !supportsThumbnailColumn && sanitizedContent
          ? this.patchContentThumbnail(sanitizedContent as any, this.extractThumbnail(project) || null)
          : sanitizedContent;
      let updated2: any;
      try {
        updated2 = await timeStep('dbUpdateMs', () =>
          this.prisma.project.update({
            where: { id },
            data: this.withOptionalContentJson(baseUpdate, contentForStorage),
          }),
        );
      } catch (e: any) {
        if (this.shouldDowngradeThumbnailColumn(e)) {
          await this.disableThumbnailColumn();
          updated2 = await timeStep('dbUpdateFallbackMs', () =>
            this.prisma.project.update({
              where: { id },
              data: this.withOptionalContentJson(
                baseUpdate,
                this.patchContentThumbnail(content as any, this.extractThumbnail(project) || null)
              ),
            }),
          );
        } else {
          // eslint-disable-next-line no-console
          console.warn('DB update(contentJson) failed, fallback without contentJson:', e);
          updated2 = await timeStep('dbUpdateMetadataOnlyMs', () =>
            this.prisma.project.update({
              where: { id },
              data: { ossPrefix: prefix, mainKey, contentVersion: newVersion },
            }),
          );
        }
      }

      if (options?.createWorkflowHistory) {
        await timeStep('workflowHistoryMs', () =>
          this.tryCreateWorkflowHistorySnapshot(
            historyUserId,
            id,
            updated2,
            sanitizedContent,
            options.workflowHistoryMeta
          ),
        );
      }

      const persistedVersion = updated2.contentVersion ?? newVersion;
      this.rememberProjectContentFingerprint(id, contentHash, persistedVersion);
      this.logProjectSaveIfHot({
        projectId: id,
        userId,
        contentBytes,
        durationMs: Date.now() - saveStartedAt,
        timings,
        version: persistedVersion,
        duplicate: false,
      });

      return {
        version: persistedVersion,
        updatedAt: updated2.updatedAt,
        mainUrl: updated2.mainKey ? this.oss.publicUrl(updated2.mainKey) : undefined,
        thumbnailUrl: this.extractThumbnail(updated2) || undefined,
        // 命中版本冲突并做了并集合并时，回传合并结果供前端 adopt（把远端新增补进本地运行时，
        // 避免下一次保存又用本地内容覆盖丢掉远端项）。非冲突路径不带这两个字段。
        ...(mergedFromConflict ? { merged: true, content: sanitizedContent } : {}),
      };
    });
  }

  async listWorkflowHistory(userId: string, projectId: string, limit?: string, role?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!project) throw new NotFoundException('项目不存在');
    const isSuperAdmin = this.isSuperAdmin(role);
    if (!isSuperAdmin && project.userId !== userId) await this.assertTeamProjectAccess(userId, projectId);
    // 超管查看他人项目时，历史记录归属项目所有者，需按所有者 userId 查询。
    const historyUserId = isSuperAdmin ? project.userId : userId;

    const parsedLimit = Math.min(Math.max(Number.parseInt((limit || '').trim(), 10) || 30, 1), 200);

    try {
      const selectWithRestoreMeta: any = {
        updatedAt: true,
        version: true,
        nodeCount: true,
        edgeCount: true,
        createdAt: true,
      };
      selectWithRestoreMeta.restoredFromUpdatedAt = true;
      selectWithRestoreMeta.restoredFromVersion = true;

      return await this.prisma.workflowHistory.findMany({
        where: { userId: historyUserId, projectId },
        orderBy: { updatedAt: 'desc' },
        take: parsedLimit,
        select: selectWithRestoreMeta,
      });
    } catch (error: any) {
      if (this.isMissingWorkflowHistoryTable(error)) return [];
      if (this.shouldDowngradeWorkflowHistoryRestoreFields(error)) {
        return await this.prisma.workflowHistory.findMany({
          where: { userId: historyUserId, projectId },
          orderBy: { updatedAt: 'desc' },
          take: parsedLimit,
          select: {
            updatedAt: true,
            version: true,
            nodeCount: true,
            edgeCount: true,
            createdAt: true,
          },
        });
      }
      throw error;
    }
  }

  async getWorkflowHistory(userId: string, projectId: string, updatedAtRaw: string, role?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!project) throw new NotFoundException('项目不存在');
    const isSuperAdmin = this.isSuperAdmin(role);
    if (!isSuperAdmin && project.userId !== userId) await this.assertTeamProjectAccess(userId, projectId);
    // 超管查看他人项目时，历史记录归属项目所有者，需按所有者 userId 查询。
    const historyUserId = isSuperAdmin ? project.userId : userId;

    const updatedAt = new Date(updatedAtRaw);
    if (Number.isNaN(updatedAt.getTime())) {
      throw new BadRequestException('updatedAt 无效，请使用 ISO 时间字符串');
    }

    try {
      const record = await this.prisma.workflowHistory.findUnique({
        where: {
          userId_projectId_updatedAt: {
            userId: historyUserId,
            projectId,
            updatedAt,
          },
        },
      });
      if (!record) throw new NotFoundException('历史版本不存在');
      return record;
    } catch (error: any) {
      if (this.isMissingWorkflowHistoryTable(error)) throw new NotFoundException('历史版本不存在');
      throw error;
    }
  }

  async cleanupExpiredWorkflowHistory() {
    const cutoff = new Date(Date.now() - this.workflowHistoryRetentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.workflowHistory.deleteMany({
      where: {
        updatedAt: {
          lt: cutoff,
        },
      },
    });

    return {
      deletedCount: result.count,
      retentionDays: this.workflowHistoryRetentionDays,
      cutoff,
    };
  }

  private async tryCreateWorkflowHistorySnapshot(
    userId: string,
    projectId: string,
    updatedProject: any,
    sanitizedContent: any,
    workflowHistoryMeta?: {
      restoredFromUpdatedAt?: string;
      restoredFromVersion?: number;
    }
  ) {
    try {
      const flow = sanitizedContent?.flow && typeof sanitizedContent.flow === 'object'
        ? sanitizedContent.flow
        : { nodes: [], edges: [] };
      const nodeCount = Array.isArray((flow as any)?.nodes) ? (flow as any).nodes.length : 0;
      const edgeCount = Array.isArray((flow as any)?.edges) ? (flow as any).edges.length : 0;

      const restoredFromUpdatedAt =
        typeof workflowHistoryMeta?.restoredFromUpdatedAt === 'string' &&
        workflowHistoryMeta.restoredFromUpdatedAt
          ? new Date(workflowHistoryMeta.restoredFromUpdatedAt)
          : null;
      const restoredFromUpdatedAtValue =
        restoredFromUpdatedAt && !Number.isNaN(restoredFromUpdatedAt.getTime())
          ? restoredFromUpdatedAt
          : null;
      const restoredFromVersionValue =
        typeof workflowHistoryMeta?.restoredFromVersion === 'number' &&
        Number.isFinite(workflowHistoryMeta.restoredFromVersion)
          ? workflowHistoryMeta.restoredFromVersion
          : null;

      try {
        const createDataWithRestoreMeta: any = {
          userId,
          projectId,
          updatedAt: updatedProject.updatedAt,
          version: updatedProject.contentVersion ?? 0,
          flow: flow as Prisma.InputJsonValue,
          nodeCount,
          edgeCount,
        };
        createDataWithRestoreMeta.restoredFromUpdatedAt = restoredFromUpdatedAtValue;
        createDataWithRestoreMeta.restoredFromVersion = restoredFromVersionValue;

        await this.prisma.workflowHistory.create({
          data: createDataWithRestoreMeta,
        });
      } catch (error: any) {
        if (this.shouldDowngradeWorkflowHistoryRestoreFields(error)) {
          await this.prisma.workflowHistory.create({
            data: {
              userId,
              projectId,
              updatedAt: updatedProject.updatedAt,
              version: updatedProject.contentVersion ?? 0,
              flow: flow as Prisma.InputJsonValue,
              nodeCount,
              edgeCount,
            },
          });
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      if (this.isMissingWorkflowHistoryTable(error)) return;
      // eslint-disable-next-line no-console
      console.warn('WorkflowHistory create failed (ignored):', error);
    }
  }

  private isMissingWorkflowHistoryTable(error: any): boolean {
    const message = typeof error?.message === 'string' ? error.message : '';
    return message.includes('WorkflowHistory') && (
      message.includes('does not exist') ||
      message.includes('relation') ||
      message.includes('no such table') ||
      message.includes('The table')
    );
  }

  private async runProjectSaveSerialized<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.projectSaveQueue.get(projectId) ?? Promise.resolve();
    let unlock: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      unlock = () => resolve();
    });
    const next = previous.catch(() => undefined).then(() => gate);
    this.projectSaveQueue.set(projectId, next);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      unlock();
      if (this.projectSaveQueue.get(projectId) === next) {
        this.projectSaveQueue.delete(projectId);
      }
    }
  }

  private hashProjectContent(content: unknown): { hash: string; bytes: number } {
    const serialized = JSON.stringify(content) ?? 'null';
    return {
      hash: createHash('sha256').update(serialized).digest('hex'),
      bytes: Buffer.byteLength(serialized, 'utf8'),
    };
  }

  private logProjectSaveIfHot(params: {
    projectId: string;
    userId: string;
    contentBytes: number;
    durationMs: number;
    timings: Record<string, number>;
    version: number;
    duplicate: boolean;
  }): void {
    if (
      params.durationMs < ProjectsService.SLOW_SAVE_LOG_MS &&
      params.contentBytes < ProjectsService.LARGE_SAVE_LOG_BYTES
    ) {
      return;
    }

    // eslint-disable-next-line no-console
    console.warn('[ProjectSaveHotspot]', JSON.stringify({
      projectId: params.projectId,
      userId: params.userId,
      contentBytes: params.contentBytes,
      durationMs: params.durationMs,
      timings: params.timings,
      version: params.version,
      duplicate: params.duplicate,
    }));
  }

  private rememberProjectContentFingerprint(projectId: string, hash: string, version: number): void {
    this.projectContentFingerprint.set(projectId, {
      hash,
      version,
      touchedAt: Date.now(),
    });
    this.pruneProjectContentFingerprintCache();
  }

  private pruneProjectContentFingerprintCache(): void {
    const now = Date.now();
    for (const [projectId, item] of this.projectContentFingerprint.entries()) {
      if (now - item.touchedAt > this.projectContentFingerprintTtlMs) {
        this.projectContentFingerprint.delete(projectId);
      }
    }

    while (this.projectContentFingerprint.size > this.projectContentFingerprintMaxEntries) {
      const oldestKey = this.projectContentFingerprint.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.projectContentFingerprint.delete(oldestKey);
    }
  }

  private withOptionalContentJson(
    base: Prisma.ProjectUpdateInput,
    content: unknown
  ): Prisma.ProjectUpdateInput {
    if (content === undefined || content === null) {
      return base;
    }

    const dataWithContent = { ...base } as Prisma.ProjectUpdateInput & Record<string, unknown>;
    dataWithContent.contentJson = content;
    return dataWithContent;
  }

  private async ensureThumbnailColumn(): Promise<void> {
    if (await this.supportsThumbnailColumn()) return;
    try {
      await this.prisma.$executeRawUnsafe(`ALTER TABLE "Project" ADD COLUMN "thumbnailUrl" TEXT`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('自动添加 thumbnailUrl 列失败，将回退到 contentJson 方案:', error);
      return;
    }
    this.thumbnailColumnChecked = false;
    await this.supportsThumbnailColumn(true);
  }

  private async supportsThumbnailColumn(forceRefresh = false): Promise<boolean> {
    if (this.thumbnailColumnChecked && !forceRefresh) return this.thumbnailColumnAvailable;

    try {
      const rows = await this.prisma.$queryRaw<{ column_name?: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'Project' AND column_name = 'thumbnailUrl'
        AND table_schema = current_schema()
        LIMIT 1
      `;
      this.thumbnailColumnAvailable = rows.length > 0;
    } catch {
      try {
        const rows = await this.prisma.$queryRaw<{ name?: string }[]>`PRAGMA table_info("Project")`;
        this.thumbnailColumnAvailable = rows.some((row) => row.name === 'thumbnailUrl');
      } catch {
        this.thumbnailColumnAvailable = false;
      }
    }

    this.thumbnailColumnChecked = true;
    return this.thumbnailColumnAvailable;
  }

  private extractThumbnail(project: any): string | undefined {
    const columnValue = project?.thumbnailUrl;
    if (columnValue) return columnValue;
    const contentJson = project?.contentJson;
    if (!contentJson || typeof contentJson !== 'object' || Array.isArray(contentJson)) {
      return undefined;
    }
    const meta: any = (contentJson as any).meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta) && typeof meta.thumbnailUrl === 'string') {
      return meta.thumbnailUrl;
    }
    if (typeof (contentJson as any).thumbnailUrl === 'string') {
      return (contentJson as any).thumbnailUrl;
    }
    return undefined;
  }

  private patchContentThumbnail(
    existing: Prisma.JsonValue | null | undefined,
    thumbnailUrl: string | null
  ): Prisma.JsonValue {
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, any>) }
        : {};

    const metaSource = base.meta;
    const meta =
      metaSource && typeof metaSource === 'object' && !Array.isArray(metaSource)
        ? { ...metaSource }
        : {};

    if (thumbnailUrl) {
      meta.thumbnailUrl = thumbnailUrl;
    } else {
      delete meta.thumbnailUrl;
    }

    if (Object.keys(meta).length === 0) {
      delete base.meta;
      return base;
    }

    return { ...base, meta };
  }

  private shouldDowngradeThumbnailColumn(error: any): boolean {
    if (!error) return false;
    const message = typeof error.message === 'string' ? error.message : '';
    return message.includes('thumbnailUrl') && (
      message.includes('Unknown argument') ||
      message.includes('Unknown arg') ||
      message.includes('column') && message.includes('does not exist')
    );
  }

  private shouldDowngradeWorkflowHistoryRestoreFields(error: any): boolean {
    if (!error) return false;
    const message = typeof error.message === 'string' ? error.message : '';
    const touchedRestoreField =
      message.includes('restoredFromUpdatedAt') ||
      message.includes('restoredFromVersion');
    if (!touchedRestoreField) return false;

    const isUnknownFieldOrArg =
      message.includes('Unknown field') ||
      message.includes('Unknown argument') ||
      message.includes('Unknown arg');
    return isUnknownFieldOrArg && message.includes('WorkflowHistory');
  }

  private async disableThumbnailColumn(): Promise<void> {
    this.thumbnailColumnChecked = true;
    this.thumbnailColumnAvailable = false;
  }

  /** 超级管理员（role='admin'）可跨项目访问任意项目，绕过所有权/团队共享校验。 */
  private isSuperAdmin(role?: string): boolean {
    return typeof role === 'string' && role.toLowerCase() === 'admin';
  }

  /** 检查 userId 是否为项目所属团队的成员，不是则抛 NotFoundException。 */
  private async assertTeamProjectAccess(userId: string, projectId: string): Promise<void> {
    const share = await this.prisma.teamProjectShare.findFirst({
      where: {
        projectId,
        team: { memberships: { some: { userId } } },
      },
    });
    if (!share) throw new NotFoundException('项目不存在');
  }

  async shareWithTeam(projectId: string, teamId: string, userId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.userId !== userId) throw new ForbiddenException('无权共享此项目');

    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      throw new ForbiddenException('需要团队 owner 或 admin 权限');
    }

    const share = await this.prisma.teamProjectShare.upsert({
      where: { projectId_teamId: { projectId, teamId } },
      create: { projectId, teamId, access: 'edit', sharedByUserId: userId },
      update: { access: 'edit', updatedAt: new Date() },
    });
    this.broadcastTeamProjectsChanged(teamId, 'shared', projectId, userId);
    return share;
  }

  async unshareFromTeam(projectId: string, teamId: string, userId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.userId !== userId) {
      // 非创建者：团队 owner/admin 可将项目移出团队
      const membership = await this.prisma.teamMembership.findUnique({
        where: { teamId_userId: { teamId, userId } },
      });
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw new ForbiddenException('无权取消共享');
      }
    }

    await this.prisma.teamProjectShare.delete({
      where: { projectId_teamId: { projectId, teamId } },
    });
    this.broadcastTeamProjectsChanged(teamId, 'unshared', projectId, userId);
    this.canvasSse?.kickTeamConnections(projectId, teamId);
  }

  async listTeamOnly(userId: string, teamId: string) {
    await this.ensureThumbnailColumn();
    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) return [];

    const shares = await this.prisma.teamProjectShare.findMany({
      where: { teamId },
      include: { project: { select: this.projectMetadataSelect } },
      orderBy: { createdAt: 'desc' },
    });

    return shares.map((s) => ({
      ...s.project,
      mainUrl: s.project.mainKey ? this.oss.publicUrl(s.project.mainKey) : undefined,
      thumbnailUrl: this.extractThumbnail(s.project) || undefined,
      access: s.project.userId === userId ? ('owner' as const) : ('team_edit' as const),
    }));
  }

  async cloneToTeam(projectId: string, teamId: string, userId: string) {
    const src = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!src || src.userId !== userId) throw new ForbiddenException('无权操作此项目');

    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) throw new ForbiddenException('你不是该团队成员');

    const cloneName = `${src.name} (团队)`;
    const newProject = await this.create(userId, cloneName);

    try {
      const { content } = await this.getContent(userId, projectId);
      if (content) {
        await this.updateContent(userId, newProject.id, content);
      }
    } catch {
      // content copy failed — continue with empty project
    }

    await this.prisma.teamProjectShare.upsert({
      where: { projectId_teamId: { projectId: newProject.id, teamId } },
      create: { projectId: newProject.id, teamId, access: 'edit', sharedByUserId: userId },
      update: {},
    });
    this.broadcastTeamProjectsChanged(teamId, 'created', newProject.id, userId);

    return { ...newProject, teamId };
  }

  async listWithTeamAccess(userId: string, teamId?: string) {
    await this.ensureThumbnailColumn();

    // 个人项目：排除已共享到团队的项目（那些只在团队视图中显示）
    const personalProjects = await this.prisma.project.findMany({
      where: { userId, teamShares: { none: {} } },
      orderBy: { createdAt: 'desc' },
      select: this.projectMetadataSelect,
    });

    const personal = personalProjects.map((p) => ({
      ...p,
      mainUrl: p.mainKey ? this.oss.publicUrl(p.mainKey) : undefined,
      thumbnailUrl: this.extractThumbnail(p) || undefined,
      access: 'owner' as const,
    }));

    if (!teamId) return personal;

    const membership = await this.prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) return personal;

    const shares = await this.prisma.teamProjectShare.findMany({
      where: { teamId },
      include: { project: { select: this.projectMetadataSelect } },
    });

    const teamShared = shares.map((s) => ({
      ...s.project,
      mainUrl: s.project.mainKey ? this.oss.publicUrl(s.project.mainKey) : undefined,
      thumbnailUrl: this.extractThumbnail(s.project) || undefined,
      access: 'team_edit' as const,
    }));

    return [...personal, ...teamShared];
  }
}
