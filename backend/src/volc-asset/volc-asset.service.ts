// backend/src/volc-asset/volc-asset.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { signVolcRequest } from './volc-sign.util';
import type { VolcAssetStatus } from './volc-asset.dto';

interface VolcEnv {
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  host: string;
  projectName: string;
  version: string;
}

interface CreateAssetGroupResp {
  Id?: string;
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}
interface CreateAssetResp {
  Id?: string;
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}
interface GetAssetResp {
  Status?: 'Processing' | 'Active' | 'Failed';
  ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
}

@Injectable()
export class VolcAssetService implements OnModuleInit {
  private readonly logger = new Logger(VolcAssetService.name);
  private env!: VolcEnv;
  // date string (YYYY-MM-DD) → groupId
  private readonly groupCache = new Map<string, string>();
  private hasLoggedMissingReviewGroupTable = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.env = {
      accessKey: (this.config.get<string>('VOLC_ARK_ACCESS_KEY') || '').trim(),
      secretKey: (this.config.get<string>('VOLC_ARK_SECRET_KEY') || '').trim(),
      region: (this.config.get<string>('VOLC_ARK_REGION') || 'cn-beijing').trim(),
      service: 'ark',
      host: (this.config.get<string>('VOLC_ARK_API_HOST') || 'open.volcengineapi.com').trim(),
      projectName: (this.config.get<string>('VOLC_ARK_PROJECT_NAME') || 'default').trim(),
      version: '2024-01-01',
    };
    if (!this.env.accessKey || !this.env.secretKey) {
      this.logger.warn(
        'VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，VolcAsset 能力不可用。',
      );
    }
  }

  private normalizeStatus(s?: string): VolcAssetStatus {
    const u = (s || '').toLowerCase();
    if (u === 'active') return 'active';
    if (u === 'failed') return 'failed';
    return 'processing';
  }

  // 北京时间 YYYY-MM-DD
  private todayDate(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private async call<T>(action: string, body: Record<string, any>): Promise<T> {
    if (!this.env.accessKey || !this.env.secretKey) {
      throw new Error('Volc asset access key not configured');
    }
    const jsonBody = JSON.stringify(body);
    const signed = signVolcRequest({
      accessKey: this.env.accessKey,
      secretKey: this.env.secretKey,
      region: this.env.region,
      service: this.env.service,
      host: this.env.host,
      method: 'POST',
      action,
      version: this.env.version,
      body: jsonBody,
    });
    // Node/undici fetch ignores (and warns about) `Host`; remove before sending.
    const { Host: _host, ...fetchHeaders } = signed.headers;
    const resp = await fetch(signed.url, {
      method: 'POST',
      headers: fetchHeaders,
      body: jsonBody,
    });
    const text = await resp.text();
    if (!resp.ok) {
      let detail = text.slice(0, 200);
      try {
        const errParsed = JSON.parse(text);
        const code = errParsed?.ResponseMetadata?.Error?.Code;
        const msg = errParsed?.ResponseMetadata?.Error?.Message;
        if (code) detail = `[${code}] ${msg || 'unknown'}`;
      } catch {
        // non-JSON error body — keep raw text
      }
      throw new Error(`Volc ${action} HTTP ${resp.status}: ${detail}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Volc ${action} bad response: ${text.slice(0, 200)}`);
    }
    const err = parsed?.ResponseMetadata?.Error;
    if (err?.Code) {
      throw new Error(`Volc ${action} error [${err.Code}]: ${err.Message || 'unknown'}`);
    }
    const unwrapped =
      parsed && typeof parsed === 'object' && parsed.Result !== undefined
        ? parsed.Result
        : parsed;
    return unwrapped as T;
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
    this.logger.warn(
      'VolcReviewGroup table is missing. Seedance will run with in-memory fallback; run Prisma migration to restore persistence.',
    );
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

    const resp = await this.call<CreateAssetGroupResp>('CreateAssetGroup', {
      Name: `tanva-review-${date}`,
      Description: `Review group for ${date}`,
      GroupType: 'AIGC',
      ProjectName: this.env.projectName,
    });
    const groupId = resp?.Id;
    if (!groupId) throw new Error('Volc CreateAssetGroup: empty Id');
    try {
      await this.prisma.volcReviewGroup.create({ data: { date, groupId } });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
      this.logMissingReviewGroupTableOnce();
    }
    this.groupCache.set(date, groupId);
    return groupId;
  }

  invalidateTodayGroup() {
    this.groupCache.delete(this.todayDate());
  }

  async uploadAsset(
    userId: string,
    sourceUrl: string,
    assetType: 'image',
  ): Promise<{ assetId: string; status: VolcAssetStatus; errorMessage?: string }> {
    const groupId = await this.ensureTodayGroup();
    const resp = await this.call<CreateAssetResp>('CreateAsset', {
      GroupId: groupId,
      URL: sourceUrl,
      AssetType: 'Image',
      ProjectName: this.env.projectName,
    });
    if (!resp?.Id) throw new Error('Volc CreateAsset: empty Id');
    const initial = await this.getAssetStatus(resp.Id).catch(() => ({
      status: 'processing' as VolcAssetStatus,
      errorMessage: undefined,
    }));
    return { assetId: resp.Id, status: initial.status, errorMessage: initial.errorMessage };
  }

  async getAssetStatus(
    assetId: string,
  ): Promise<{ status: VolcAssetStatus; errorMessage?: string }> {
    const resp = await this.call<GetAssetResp>('GetAsset', {
      Id: assetId,
      ProjectName: this.env.projectName,
    });
    return {
      status: this.normalizeStatus(resp?.Status),
      errorMessage: undefined,
    };
  }

  async deleteAssetGroup(groupId: string): Promise<void> {
    await this.call<Record<string, unknown>>('DeleteAssetGroup', {
      Id: groupId,
      ProjectName: this.env.projectName,
    });
  }

  async listReviewGroups() {
    try {
      return await this.prisma.volcReviewGroup.findMany({
        orderBy: { date: 'desc' },
      });
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
      record = await this.prisma.volcReviewGroup.findUnique({
        where: { date: targetDate },
        select: { groupId: true },
      });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
      this.logMissingReviewGroupTableOnce();
      return { date: targetDate, deleted: false };
    }
    if (!record) return { date: targetDate, deleted: false };

    await this.deleteAssetGroup(record.groupId);
    try {
      await this.prisma.volcReviewGroup.delete({ where: { date: targetDate } });
    } catch (error) {
      if (!this.isVolcReviewGroupTableMissing(error)) throw error;
      this.logMissingReviewGroupTableOnce();
    }
    this.groupCache.delete(targetDate);
    return { date: targetDate, deleted: true };
  }

  async cleanupExpiredGroup(): Promise<{ date: string; deleted: boolean }> {
    return this.cleanupGroupByDate();
  }
}
