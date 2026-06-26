// backend/src/ai/services/seed-audio-voice.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signVolcRequest } from '../../volc-asset/volc-sign.util';

/** 前端消费的精简音色元数据 */
export interface SeedAudioVoiceMeta {
  id: string; // VoiceType → 填入 seed-audio 的 speaker
  name: string;
  avatar: string; // 头像 png url（可能为空）
  trialUrl: string; // 试听 wav url（可能为空）
  gender: string; // 女 / 男
  age: string; // 青年 …
  scene: string; // 首个场景标签
  description: string;
  emotions: string[]; // 情感标签
}

interface VolcSpeaker {
  VoiceType?: string;
  Name?: string;
  Avatar?: string;
  TrialURL?: string;
  ShortTrialURL?: string;
  Gender?: string;
  Age?: string;
  Description?: string;
  Categories?: Array<{ Categories?: string[] }>;
  Emotions?: Array<{ Icon?: string; Label?: string; Value?: string }>;
}

/**
 * 拉取火山引擎 seed-tts-2.0 音色目录（ListSpeakers），映射为前端可直接渲染的
 * 富音色元数据（头像 + 试听）。结果在内存缓存 ~6h，复用 VolcAsset 的 ARK 凭证。
 */
@Injectable()
export class SeedAudioVoiceService {
  private readonly logger = new Logger(SeedAudioVoiceService.name);
  private readonly accessKey = (this.config.get<string>('VOLC_ARK_ACCESS_KEY') || '').trim();
  private readonly secretKey = (this.config.get<string>('VOLC_ARK_SECRET_KEY') || '').trim();
  private readonly region = 'cn-beijing';
  private readonly service = 'speech_saas_prod';
  private readonly host = 'open.volcengineapi.com';
  private readonly action = 'ListSpeakers';
  private readonly version = '2025-05-20';
  private readonly resourceId = 'seed-tts-2.0';
  private readonly pageLimit = 100;
  private readonly cacheTtlMs = 6 * 60 * 60 * 1000; // 6h

  private cache: SeedAudioVoiceMeta[] | null = null;
  private cacheTimestamp = 0;
  private inflight: Promise<SeedAudioVoiceMeta[]> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** 返回音色目录；未配置凭证或拉取失败时优雅返回空数组（永不抛出）。 */
  async getVoices(): Promise<SeedAudioVoiceMeta[]> {
    if (this.cache && Date.now() - this.cacheTimestamp < this.cacheTtlMs) {
      return this.cache;
    }
    if (!this.accessKey || !this.secretKey) {
      this.logger.warn('VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置，seed-audio 音色目录不可用。');
      return [];
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.loadAllVoices()
      .then((voices) => {
        if (voices.length > 0) {
          this.cache = voices;
          this.cacheTimestamp = Date.now();
        }
        return voices;
      })
      .catch((error) => {
        this.logger.error(`拉取 seed-audio 音色目录失败: ${error instanceof Error ? error.message : error}`);
        // 失败时回落到旧缓存（若有），否则空数组
        return this.cache || [];
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  private async loadAllVoices(): Promise<SeedAudioVoiceMeta[]> {
    const collected: SeedAudioVoiceMeta[] = [];
    let page = 1;
    let total = Infinity;

    // 分页直到收集满 Result.Total（防御性上限 50 页 = 5000 条）
    while (collected.length < total && page <= 50) {
      const { speakers, pageTotal } = await this.fetchPage(page);
      total = pageTotal;
      if (speakers.length === 0) break;
      for (const sp of speakers) collected.push(this.mapSpeaker(sp));
      if (speakers.length < this.pageLimit) break;
      page += 1;
    }

    this.logger.log(`seed-audio 音色目录拉取完成：${collected.length} / ${Number.isFinite(total) ? total : '?'} 条。`);
    return collected;
  }

  private async fetchPage(page: number): Promise<{ speakers: VolcSpeaker[]; pageTotal: number }> {
    const body = JSON.stringify({ ResourceIDs: [this.resourceId], Page: page, Limit: this.pageLimit });
    const signed = signVolcRequest({
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: this.region,
      service: this.service,
      host: this.host,
      method: 'POST',
      action: this.action,
      version: this.version,
      body,
    });

    const response = await fetch(signed.url, { method: 'POST', headers: signed.headers, body });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ListSpeakers HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json: any = await response.json();
    const result = json?.Result || {};
    const speakers: VolcSpeaker[] = Array.isArray(result.Speakers) ? result.Speakers : [];
    const pageTotal = typeof result.Total === 'number' ? result.Total : speakers.length;
    return { speakers, pageTotal };
  }

  private mapSpeaker(sp: VolcSpeaker): SeedAudioVoiceMeta {
    const firstScene = sp.Categories?.[0]?.Categories?.[0] || '通用场景';
    return {
      id: sp.VoiceType || '',
      name: sp.Name || sp.VoiceType || '',
      avatar: sp.Avatar || '',
      trialUrl: sp.TrialURL || sp.ShortTrialURL || '',
      gender: sp.Gender || '',
      age: sp.Age || '',
      scene: firstScene,
      description: sp.Description || '',
      emotions: Array.isArray(sp.Emotions)
        ? sp.Emotions.map((e) => e?.Label || '').filter((l): l is string => Boolean(l))
        : [],
    };
  }
}
