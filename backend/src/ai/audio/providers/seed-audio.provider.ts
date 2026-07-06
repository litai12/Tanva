import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import { OssService } from '../../../oss/oss.service';
import { AudioGenerateDto } from '../audio-generate.dto';
import {
  AudioGenerateContext,
  AudioGenerateResult,
  IAudioProvider,
} from '../audio-provider.interface';

const SEED_AUDIO_MODEL = 'doubao-seed-audio-1-0';

/**
 * seed-audio（豆包 doubao-seed-audio-1-0）provider。
 *
 * 经 new-api `POST /v1/audio/speech`（Bearer 网关 token）合成音频，读取原始字节，
 * 上传 OSS 取得永久 URL。计费单轨：从响应头 `X-NewApi-Consumed-Credits` 读取
 * new-api 实际定价的积分，透出 `consumedCredits` 给控制器 `withCreditsFromGateway`
 * 后扣；价格只存在于 new-api（后端不在 credits.config 配置 seed-audio）。
 */
@Injectable()
export class SeedAudioProvider implements IAudioProvider {
  readonly mode = 'seed-audio' as const;
  private readonly logger = new Logger(SeedAudioProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly oss: OssService,
  ) {}

  private baseUrl(): string {
    return (
      this.config.get<string>('NEW_API_BASE_URL') ||
      process.env.NEW_API_BASE_URL ||
      'http://localhost:4458'
    ).replace(/\/+$/, '');
  }

  private apiKey(): string {
    return (
      this.config.get<string>('NEW_API_KEY') ||
      process.env.NEW_API_KEY ||
      this.config.get<string>('NEW_API_TOKEN') ||
      process.env.NEW_API_TOKEN ||
      ''
    ).trim();
  }

  async generate(
    req: AudioGenerateDto,
    ctx?: AudioGenerateContext,
  ): Promise<AudioGenerateResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException('服务端未配置 NEW_API_KEY，无法调用 seed-audio');
    }

    const text = (req.text || '').trim();
    if (!text) {
      throw new BadRequestException('seed-audio 需要合成文本（text）');
    }

    const format = req.format || 'wav';
    const metadata = this.buildMetadata(req);
    const payload = this.stripUndefined({
      model: SEED_AUDIO_MODEL,
      input: text,
      voice: req.voice || '',
      response_format: format,
      speed: typeof req.speechRate === 'number' ? req.speechRate : undefined,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });

    const url = `${this.baseUrl()}/v1/audio/speech`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(`seed-audio 请求失败：${message}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new BadGatewayException(
        `seed-audio 调用失败（${response.status}）${errText ? `：${errText.slice(0, 300)}` : ''}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new BadGatewayException('seed-audio 返回了空音频');
    }

    const consumedCredits = this.parseIntHeader(
      response.headers.get('x-newapi-consumed-credits'),
    );
    const durationSec = this.parseFloatHeader(
      response.headers.get('x-newapi-audio-duration'),
    );

    const audioUrl = await this.uploadAudio(buffer, format, ctx?.projectId);

    this.logger.log(
      `seed-audio 合成完成: bytes=${buffer.length}, format=${format}, durationSec=${
        durationSec ?? 'N/A'
      }, consumedCredits=${consumedCredits ?? 'N/A'}, projectId=${ctx?.projectId || 'shared'}`,
    );

    return {
      audioUrl,
      durationSec,
      mode: 'seed-audio',
      provider: 'volcengine',
      consumedCredits,
    };
  }

  private buildMetadata(req: AudioGenerateDto): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    if (typeof req.sampleRate === 'number') metadata.sample_rate = req.sampleRate;
    if (typeof req.loudnessRate === 'number') metadata.loudness_rate = req.loudnessRate;
    if (typeof req.pitchRate === 'number') metadata.pitch_rate = req.pitchRate;

    const refImage = (req.referenceImageUrl || '').trim();
    const refAudios = Array.isArray(req.referenceAudioUrls)
      ? req.referenceAudioUrls.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
      : [];

    // 图片参考与音频参考互斥（图片优先于音频）。
    if (refImage) {
      metadata.image_url = refImage;
    } else if (refAudios.length === 1) {
      metadata.audio_url = refAudios[0];
    } else if (refAudios.length > 1) {
      metadata.references = refAudios.map((audio_url) => ({ audio_url }));
    }

    return metadata;
  }

  private async uploadAudio(
    buffer: Buffer,
    format: string,
    projectId?: string,
  ): Promise<string> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException('OSS 未启用，无法保存 seed-audio 音频');
    }
    const ext = this.formatToExt(format);
    const contentType = this.formatToMime(format);
    const dir = projectId
      ? `projects/${projectId}/audios`
      : 'projects/shared/audios';
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const key = `${dir}/${datePart}/${name}`;

    const uploaded = await this.oss.putBuffer(key, buffer, contentType);
    if (!uploaded.url) {
      throw new ServiceUnavailableException('seed-audio 音频上传 OSS 后未返回可用 URL');
    }
    return uploaded.url;
  }

  private formatToExt(format: string): string {
    switch (format) {
      case 'mp3':
        return 'mp3';
      case 'ogg_opus':
        return 'ogg';
      case 'pcm':
        return 'pcm';
      case 'wav':
      default:
        return 'wav';
    }
  }

  private formatToMime(format: string): string {
    switch (format) {
      case 'mp3':
        return 'audio/mpeg';
      case 'ogg_opus':
        return 'audio/ogg';
      case 'pcm':
        return 'audio/L16';
      case 'wav':
      default:
        return 'audio/wav';
    }
  }

  private parseIntHeader(value: string | null): number | undefined {
    if (value == null) return undefined;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  private parseFloatHeader(value: string | null): number | undefined {
    if (value == null) return undefined;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  private stripUndefined(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
  }
}
