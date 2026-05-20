// backend/src/volc-asset/volc-asset.service.ts
// Asset upload is delegated to new-api (/v1/assets). new-api holds the ARK AK/SK
// and handles CreateAsset / group management internally. NestJS is no longer a
// direct ARK client.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { VolcAssetStatus } from './volc-asset.dto';

@Injectable()
export class VolcAssetService implements OnModuleInit {
  private readonly logger = new Logger(VolcAssetService.name);
  private newApiBaseUrl = 'http://localhost:4458';
  private newApiKey = '';
  private hasLoggedMissingReviewGroupTable = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.newApiBaseUrl = (
      this.config.get<string>('NEW_API_BASE_URL') ||
      process.env.NEW_API_BASE_URL ||
      'http://localhost:4458'
    ).replace(/\/+$/, '');
    this.newApiKey =
      this.config.get<string>('NEW_API_KEY') ||
      process.env.NEW_API_KEY ||
      this.config.get<string>('NEW_API_TOKEN') ||
      process.env.NEW_API_TOKEN ||
      '';
    if (!this.newApiKey) {
      this.logger.warn('NEW_API_KEY 未配置，VolcAsset 素材上传能力不可用。');
    } else {
      this.logger.log(`VolcAssetService 已初始化，通过 new-api (${this.newApiBaseUrl}) 上传素材。`);
    }
  }

  isConfigured(): boolean {
    return !!this.newApiKey;
  }

  // ── 核心素材操作（委托给 new-api） ──────────────────────────────────────

  async uploadAsset(
    _userId: string,
    sourceUrl: string,
    assetType: 'image',
  ): Promise<{ assetId: string; status: VolcAssetStatus; errorMessage?: string }> {
    if (!this.newApiKey) {
      throw new Error('NEW_API_KEY 未配置，素材上传不可用');
    }

    const resp = await fetch(`${this.newApiBaseUrl}/v1/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.newApiKey}`,
      },
      body: JSON.stringify({ source_url: sourceUrl, type: assetType }),
    });

    const data = await this.parseJson(resp);

    if (!resp.ok) {
      throw new Error(
        data?.error?.message || data?.message || `new-api /v1/assets HTTP ${resp.status}`,
      );
    }

    const assetId = String(data?.id || data?.asset_id || '').trim();
    if (!assetId) {
      throw new Error(`new-api 未返回素材 ID: ${JSON.stringify(data)}`);
    }

    return {
      assetId,
      status: this.normalizeStatus(data?.status),
      errorMessage: data?.error_message || undefined,
    };
  }

  async getAssetStatus(
    assetId: string,
  ): Promise<{ status: VolcAssetStatus; errorMessage?: string }> {
    if (!this.newApiKey) {
      throw new Error('NEW_API_KEY 未配置');
    }

    const resp = await fetch(
      `${this.newApiBaseUrl}/v1/assets/${encodeURIComponent(assetId)}`,
      { headers: { Authorization: `Bearer ${this.newApiKey}` } },
    );

    const data = await this.parseJson(resp);

    if (!resp.ok) {
      throw new Error(
        data?.error?.message || data?.message || `new-api /v1/assets/${assetId} HTTP ${resp.status}`,
      );
    }

    return {
      status: this.normalizeStatus(data?.status),
      errorMessage: data?.error_message || undefined,
    };
  }

  // ── 素材组管理（noop — 现在由 new-api 内部维护） ────────────────────────

  /** @deprecated new-api 内部管理素材组，此方法已废弃，保留以避免调用方报错。 */
  invalidateTodayGroup(): void {
    // noop
  }

  /** @deprecated new-api 内部管理素材组。 */
  async ensureTodayGroup(): Promise<string> {
    return '';
  }

  /** 返回历史遗留的审核组记录（DB 中已有的数据），新数据不再写入。 */
  async listReviewGroups() {
    try {
      return await this.prisma.volcReviewGroup.findMany({ orderBy: { date: 'desc' } });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
      this.logMissingReviewGroupTableOnce();
      return [];
    }
  }

  /** @deprecated 素材组生命周期由 new-api 管理，NestJS 侧不再执行清理。 */
  async cleanupGroupByDate(_date?: string): Promise<{ date: string; deleted: boolean }> {
    return { date: _date || '', deleted: false };
  }

  /** @deprecated 素材组生命周期由 new-api 管理，NestJS 侧不再执行清理。 */
  async cleanupExpiredGroup(): Promise<{ date: string; deleted: boolean }> {
    return { date: '', deleted: false };
  }

  // ── 私有工具 ─────────────────────────────────────────────────────────────

  private normalizeStatus(s?: string): VolcAssetStatus {
    const u = (s || '').toLowerCase();
    if (u === 'active') return 'active';
    if (u === 'failed') return 'failed';
    return 'processing';
  }

  private async parseJson(resp: Response): Promise<any> {
    const text = await resp.text().catch(() => '');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { message: text.slice(0, 200) };
    }
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
