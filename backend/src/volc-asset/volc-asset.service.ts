// backend/src/volc-asset/volc-asset.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { signVolcRequest } from './volc-sign.util';
import type { VolcAssetStatus } from './volc-asset.dto';

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
  // date (YYYY-MM-DD, 北京时间) → groupId
  private readonly groupCache = new Map<string, string>();

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

  async getAssetStatus(
    assetId: string,
  ): Promise<{ status: VolcAssetStatus; errorMessage?: string }> {
    if (!this.isConfigured()) {
      throw new Error('VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置');
    }
    const result = await this.volcCall('GetAsset', {
      Id: assetId,
      ProjectName: this.projectName,
    });
    const status = this.normalizeStatus((result as any)?.Status);
    return { status };
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
    const result = await this.volcCall('CreateAssetGroup', {
      Name: `tanva-review-${date}`,
      Description: `Review group for ${date}`,
      GroupType: 'AIGC',
      ProjectName: this.projectName,
    });
    const id = (result as any)?.Id as string;
    if (!id) throw new Error('CreateAssetGroup: empty Id in response');
    return id;
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
      if (status === 'failed') throw new Error(`asset ${assetId} 内容审核未通过`);
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

    if (!resp.ok) {
      throw new Error(`${action}: client error ${resp.status}: ${text.slice(0, 200)}`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${action}: invalid JSON response: ${text.slice(0, 200)}`);
    }

    const err = parsed?.ResponseMetadata?.Error;
    if (err?.Code) {
      throw new Error(`${action}: [${err.Code}] ${err.Message || ''}`);
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

  private logMissingReviewGroupTableOnce() {
    if (this.hasLoggedMissingReviewGroupTable) return;
    this.hasLoggedMissingReviewGroupTable = true;
    this.logger.warn('VolcReviewGroup 表不存在，listReviewGroups 返回空列表。');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
