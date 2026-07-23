// backend/src/volc-asset/volc-asset.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { signVolcRequest } from './volc-sign.util';
import type { VolcAssetStatus } from './volc-asset.dto';
import {
  VolcAssetReviewRejectedError,
  VolcAssetUpstreamError,
} from './volc-asset-error.util';

export type TaskAssetReference = {
  url: string;
  volcAssetId: string;
  volcAssetStatus: 'active';
};

type InMemoryTaskGroup = {
  groupId: string;
  taskId?: string;
  expiresAt: Date;
};

@Injectable()
export class VolcAssetService implements OnModuleInit {
  private readonly logger = new Logger(VolcAssetService.name);
  private accessKey = '';
  private secretKey = '';
  private region = 'cn-beijing';
  private host = 'open.volcengineapi.com';
  private projectName = 'default';
  private readonly version = '2024-01-01';
  private hasLoggedMissingReviewGroupTable = false;
  private hasLoggedMissingTaskGroupTable = false;
  private taskGroupLifetimeMs = 24 * 60 * 60 * 1000;
  // date (YYYY-MM-DD, 北京时间) → groupId
  private readonly groupCache = new Map<string, string>();
  private readonly taskGroupsById = new Map<string, InMemoryTaskGroup>();
  private readonly taskGroupIdByTaskId = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.accessKey = (this.config.get<string>('VOLC_ARK_ACCESS_KEY') || '').trim();
    this.secretKey = (this.config.get<string>('VOLC_ARK_SECRET_KEY') || '').trim();
    this.region = (this.config.get<string>('VOLC_ARK_REGION') || 'cn-beijing').trim();
    this.host = (this.config.get<string>('VOLC_ARK_API_HOST') || 'open.volcengineapi.com').trim();
    this.projectName = (this.config.get<string>('VOLC_ARK_PROJECT_NAME') || 'default').trim();
    const configuredLifetimeHours = Number(
      this.config.get<string>('VOLC_TASK_ASSET_GROUP_TTL_HOURS') || 24,
    );
    if (Number.isFinite(configuredLifetimeHours) && configuredLifetimeHours >= 1) {
      this.taskGroupLifetimeMs = Math.floor(configuredLifetimeHours * 60 * 60 * 1000);
    }
    if (!this.accessKey || !this.secretKey) {
      this.logger.warn('VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，VolcAsset 素材上传能力不可用。');
    } else {
      this.logger.log('VolcAssetService 已初始化，直接调用 Volcengine ARK API。');
    }
  }

  isConfigured(): boolean {
    return !!(this.accessKey && this.secretKey);
  }

  // ── 核心素材操作 ──────────────────────────────────────────────────────────

  async uploadAsset(
    _userId: string,
    sourceUrl: string,
    _assetType: 'image',
  ): Promise<{ assetId: string; status: VolcAssetStatus; errorMessage?: string }> {
    if (!this.isConfigured()) {
      throw new Error('VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，素材上传不可用');
    }

    // 使用当天共享组，避免上传后立即删组导致 asset 失效
    const groupId = await this.ensureTodayGroup();
    const assetId = await this.createAsset(groupId, sourceUrl);
    await this.pollAssetActive(assetId, 120_000);
    return { assetId, status: 'active' };
  }

  async getAssetStatus(assetId: string): Promise<{ status: VolcAssetStatus; errorMessage?: string }> {
    if (!this.isConfigured()) {
      throw new Error('VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置');
    }
    const result = await this.volcCall('GetAsset', { Id: assetId, ProjectName: this.projectName });
    const status = this.normalizeStatus((result as any)?.Status);
    const errorMessage = status === 'failed' ? ((result as any)?.AuditMessage || '内容审核未通过') : undefined;
    return { status, ...(errorMessage ? { errorMessage } : {}) };
  }

  async createTaskAssetGroup(sourceUrls: string[]): Promise<{
    groupId: string;
    references: TaskAssetReference[];
  }> {
    if (!this.isConfigured()) {
      throw new Error('VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，素材上传不可用');
    }
    const urls = sourceUrls.map((url) => url.trim()).filter(Boolean);
    if (!urls.length) throw new Error('一次性审核素材组缺少图片 URL');

    const suffix = randomUUID().replace(/-/g, '').slice(0, 16);
    const groupId = await this.createAssetGroup(
      `tanva-task-${Date.now()}-${suffix}`,
      'Ephemeral review assets for one video generation task',
    );
    const expiresAt = new Date(Date.now() + this.taskGroupLifetimeMs);
    await this.rememberTaskGroup({ groupId, expiresAt });

    try {
      const created = [] as Array<{ url: string; assetId: string }>;
      for (const url of urls) {
        created.push({ url, assetId: await this.createAsset(groupId, url) });
      }
      const auditResults = await Promise.allSettled(
        created.map(({ assetId }) => this.pollAssetActive(assetId, 120_000)),
      );
      const rejectedAudit = auditResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (rejectedAudit) throw rejectedAudit.reason;
      return {
        groupId,
        references: created.map(({ url, assetId }) => ({
          url,
          volcAssetId: assetId,
          volcAssetStatus: 'active' as const,
        })),
      };
    } catch (error) {
      await this.cleanupTaskAssetGroupById(groupId, 'prepare_failed');
      throw error;
    }
  }

  async bindTaskAssetGroup(groupId: string, taskId: string): Promise<void> {
    const normalizedTaskId = taskId.trim();
    if (!groupId || !normalizedTaskId) return;
    const current = this.taskGroupsById.get(groupId);
    if (current) {
      current.taskId = normalizedTaskId;
      this.taskGroupIdByTaskId.set(normalizedTaskId, groupId);
    }

    const delegate = (this.prisma as any).volcTaskAssetGroup;
    if (!delegate || this.hasLoggedMissingTaskGroupTable) return;
    try {
      await delegate.update({
        where: { groupId },
        data: { taskId: normalizedTaskId, status: 'running', lastError: null },
      });
    } catch (error) {
      if (!this.isVolcTaskAssetGroupTableMissing(error)) {
        this.logger.error(`绑定一次性素材组失败 group=${groupId} task=${normalizedTaskId}: ${this.errorMessage(error)}`);
        return;
      }
      this.logMissingTaskGroupTableOnce();
    }
  }

  async cleanupTaskAssetGroup(taskId: string, terminalStatus: string): Promise<boolean> {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) return false;
    let groupId = this.taskGroupIdByTaskId.get(normalizedTaskId);

    if (!groupId) {
      const delegate = (this.prisma as any).volcTaskAssetGroup;
      if (!delegate || this.hasLoggedMissingTaskGroupTable) return false;
      try {
        const record = await delegate.findFirst({
          where: { taskId: normalizedTaskId, deletedAt: null, status: { not: 'deleted' } },
        });
        groupId = record?.groupId;
      } catch (error) {
        if (!this.isVolcTaskAssetGroupTableMissing(error)) {
          this.logger.warn(`查询任务素材组失败 task=${normalizedTaskId}: ${this.errorMessage(error)}`);
          return false;
        }
        this.logMissingTaskGroupTableOnce();
        return false;
      }
    }
    if (!groupId) return false;
    return this.cleanupTaskAssetGroupById(groupId, terminalStatus);
  }

  async cleanupExpiredTaskAssetGroups(): Promise<{ deleted: number; failed: number }> {
    const groupIds = new Set<string>();
    const now = new Date();
    for (const group of this.taskGroupsById.values()) {
      if (group.expiresAt.getTime() <= now.getTime()) groupIds.add(group.groupId);
    }

    const delegate = (this.prisma as any).volcTaskAssetGroup;
    if (delegate && !this.hasLoggedMissingTaskGroupTable) {
      try {
        const records = await delegate.findMany({
          where: {
            deletedAt: null,
            expiresAt: { lte: now },
            status: { not: 'deleted' },
          },
          select: { groupId: true },
        });
        records.forEach((record: { groupId: string }) => groupIds.add(record.groupId));
      } catch (error) {
        if (!this.isVolcTaskAssetGroupTableMissing(error)) throw error;
        this.logMissingTaskGroupTableOnce();
      }
    }

    let deleted = 0;
    let failed = 0;
    for (const groupId of groupIds) {
      if (await this.cleanupTaskAssetGroupById(groupId, 'expired')) deleted += 1;
      else failed += 1;
    }
    return { deleted, failed };
  }

  // ── 素材组管理 ────────────────────────────────────────────────────────────

  invalidateTodayGroup(): void {
    this.groupCache.delete(this.todayDate());
  }

  async ensureTodayGroup(): Promise<string> {
    const date = this.todayDate();
    const cached = this.groupCache.get(date);
    if (cached) return cached;

    try {
      const existing = await this.prisma.volcReviewGroup.findUnique({ where: { date } });
      if (existing) {
        this.groupCache.set(date, existing.groupId);
        return existing.groupId;
      }
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
      this.logMissingReviewGroupTableOnce();
    }

    const groupId = await this.createDailyAssetGroup(date);
    try {
      await this.prisma.volcReviewGroup.create({ data: { date, groupId } });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
    }
    this.groupCache.set(date, groupId);
    return groupId;
  }

  async listReviewGroups() {
    try {
      return await this.prisma.volcReviewGroup.findMany({ orderBy: { date: 'desc' } });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
      this.logMissingReviewGroupTableOnce();
      return [];
    }
  }

  // date: YYYY-MM-DD（北京时间）。不传则取 3 天前。
  async cleanupGroupByDate(date?: string): Promise<{ date: string; deleted: boolean }> {
    const targetDate = date ?? (() => {
      const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
      d.setDate(d.getDate() - 3);
      return d.toISOString().slice(0, 10);
    })();

    let record: { groupId: string } | null = null;
    try {
      record = await this.prisma.volcReviewGroup.findUnique({ where: { date: targetDate } });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
    }
    if (!record) return { date: targetDate, deleted: false };

    try {
      await this.deleteAssetGroup(record.groupId);
    } catch (e: any) {
      this.logger.warn(`cleanupGroupByDate: deleteAssetGroup ${record.groupId}: ${e?.message}`);
    }
    try {
      await this.prisma.volcReviewGroup.delete({ where: { date: targetDate } });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
    }
    this.groupCache.delete(targetDate);
    return { date: targetDate, deleted: true };
  }

  async cleanupExpiredGroup(): Promise<{ date: string; deleted: boolean }> {
    return this.cleanupGroupByDate();
  }

  // ── 私有 ARK 操作 ─────────────────────────────────────────────────────────

  private todayDate(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private async createDailyAssetGroup(date: string): Promise<string> {
    return this.createAssetGroup(`tanva-review-${date}`, `Review group for ${date}`);
  }

  private async createAssetGroup(name: string, description: string): Promise<string> {
    const result = await this.volcCall('CreateAssetGroup', {
      Name: name,
      Description: description,
      GroupType: 'AIGC',
      ProjectName: this.projectName,
    });
    const id = (result as any)?.Id as string;
    if (!id) throw new Error('CreateAssetGroup: empty Id in response');
    return id;
  }

  private async rememberTaskGroup(group: InMemoryTaskGroup): Promise<void> {
    this.taskGroupsById.set(group.groupId, group);
    const delegate = (this.prisma as any).volcTaskAssetGroup;
    if (!delegate || this.hasLoggedMissingTaskGroupTable) return;
    try {
      await delegate.create({
        data: {
          groupId: group.groupId,
          status: 'preparing',
          expiresAt: group.expiresAt,
        },
      });
    } catch (error) {
      if (!this.isVolcTaskAssetGroupTableMissing(error)) {
        this.logger.error(`记录一次性素材组失败 group=${group.groupId}: ${this.errorMessage(error)}`);
        return;
      }
      this.logMissingTaskGroupTableOnce();
    }
  }

  async cleanupTaskAssetGroupById(
    groupId: string,
    reason: string,
  ): Promise<boolean> {
    try {
      await this.deleteAssetGroup(groupId);
    } catch (error) {
      const message = this.errorMessage(error);
      if (!/not[ -]?found|does not exist/i.test(message)) {
        this.logger.warn(`删除一次性素材组失败 group=${groupId} reason=${reason}: ${message}`);
        await this.markTaskGroupCleanupFailed(groupId, message);
        return false;
      }
    }

    const memory = this.taskGroupsById.get(groupId);
    if (memory?.taskId) this.taskGroupIdByTaskId.delete(memory.taskId);
    this.taskGroupsById.delete(groupId);

    const delegate = (this.prisma as any).volcTaskAssetGroup;
    if (delegate && !this.hasLoggedMissingTaskGroupTable) {
      try {
        await delegate.updateMany({
          where: { groupId, deletedAt: null },
          data: { status: 'deleted', deletedAt: new Date(), lastError: null },
        });
      } catch (error) {
        if (!this.isVolcTaskAssetGroupTableMissing(error)) {
          this.logger.warn(`更新一次性素材组删除状态失败 group=${groupId}: ${this.errorMessage(error)}`);
        } else {
          this.logMissingTaskGroupTableOnce();
        }
      }
    }
    this.logger.log(`一次性素材组已清理 group=${groupId} reason=${reason}`);
    return true;
  }

  private async markTaskGroupCleanupFailed(groupId: string, message: string): Promise<void> {
    const delegate = (this.prisma as any).volcTaskAssetGroup;
    if (!delegate || this.hasLoggedMissingTaskGroupTable) return;
    try {
      await delegate.updateMany({
        where: { groupId, deletedAt: null },
        data: { status: 'cleanup_failed', lastError: message },
      });
    } catch (error) {
      if (this.isVolcTaskAssetGroupTableMissing(error)) this.logMissingTaskGroupTableOnce();
    }
  }

  private async createAsset(groupId: string, sourceUrl: string): Promise<string> {
    const result = await this.volcCall('CreateAsset', {
      GroupId: groupId,
      URL: sourceUrl,
      AssetType: 'Image',
      ProjectName: this.projectName,
    });
    const id = (result as any)?.Id as string;
    if (!id) throw new Error('CreateAsset: empty Id in response');
    return id;
  }

  private async pollAssetActive(assetId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.volcCall('GetAsset', {
        Id: assetId,
        ProjectName: this.projectName,
      });
      const status = this.normalizeStatus((result as any)?.Status);
      if (status === 'active') return;
      if (status === 'failed') {
        throw new VolcAssetReviewRejectedError(
          typeof (result as any)?.AuditMessage === 'string'
            ? (result as any).AuditMessage
            : undefined,
        );
      }
      await sleep(3000);
    }
    throw new Error(`asset ${assetId} 上传超时`);
  }

  private async deleteAssetGroup(groupId: string): Promise<void> {
    if (!groupId) return;
    await this.volcCall('DeleteAssetGroup', {
      Id: groupId,
      ProjectName: this.projectName,
    });
  }

  private async volcCall(action: string, body: Record<string, any>): Promise<unknown> {
    const jsonBody = JSON.stringify(body);
    const signed = signVolcRequest({
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: this.region,
      service: 'ark',
      host: this.host,
      method: 'POST',
      action,
      version: this.version,
      body: jsonBody,
    });
    const { Host: _host, ...fetchHeaders } = signed.headers;
    const resp = await fetch(signed.url, {
      method: 'POST',
      headers: fetchHeaders,
      body: jsonBody,
    });
    const text = await resp.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!resp.ok) {
        throw new VolcAssetUpstreamError(
          action,
          resp.status,
          undefined,
          text.slice(0, 200) || `HTTP ${resp.status}`,
        );
      }
      throw new Error(`${action}: invalid JSON response: ${text.slice(0, 200)}`);
    }

    const metadata = parsed?.ResponseMetadata;
    const err = parsed?.ResponseMetadata?.Error;
    if (err?.Code) {
      throw new VolcAssetUpstreamError(
        action,
        resp.status,
        String(err.Code),
        typeof err.Message === 'string' ? err.Message : undefined,
        typeof metadata?.RequestId === 'string' ? metadata.RequestId : undefined,
      );
    }

    if (!resp.ok) {
      throw new VolcAssetUpstreamError(
        action,
        resp.status,
        undefined,
        `HTTP ${resp.status}`,
        typeof metadata?.RequestId === 'string' ? metadata.RequestId : undefined,
      );
    }

    return parsed?.Result ?? parsed;
  }

  // ── 工具 ──────────────────────────────────────────────────────────────────

  private normalizeStatus(s?: string): VolcAssetStatus {
    const u = (s || '').toLowerCase();
    if (u === 'active') return 'active';
    if (u === 'failed') return 'failed';
    return 'processing';
  }

  private isVolcReviewGroupTableMissing(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const maybe = error as { code?: string; meta?: { table?: string }; message?: string };
    const tableName = `${maybe.meta?.table || ''}`.toLowerCase();
    const message = `${maybe.message || ''}`.toLowerCase();
    if (maybe.code === 'P2021' && tableName.includes('volcreviewgroup')) return true;
    return message.includes('volcreviewgroup') && message.includes('does not exist');
  }

  private isVolcTaskAssetGroupTableMissing(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const maybe = error as { code?: string; meta?: { table?: string }; message?: string };
    const tableName = `${maybe.meta?.table || ''}`.toLowerCase();
    const message = `${maybe.message || ''}`.toLowerCase();
    if (maybe.code === 'P2021' && tableName.includes('volctaskassetgroup')) return true;
    return message.includes('volctaskassetgroup') && message.includes('does not exist');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'unknown error');
  }

  private logMissingReviewGroupTableOnce() {
    if (this.hasLoggedMissingReviewGroupTable) return;
    this.hasLoggedMissingReviewGroupTable = true;
    this.logger.warn('VolcReviewGroup 表不存在，listReviewGroups 返回空列表。');
  }

  private logMissingTaskGroupTableOnce() {
    if (this.hasLoggedMissingTaskGroupTable) return;
    this.hasLoggedMissingTaskGroupTable = true;
    this.logger.warn('VolcTaskAssetGroup 表不存在，只能在当前进程内跟踪一次性素材组。');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
