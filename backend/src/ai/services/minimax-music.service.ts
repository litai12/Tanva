import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MINIMAX_MUSIC_MODELS,
  MinimaxMusicDto,
  MinimaxMusicModel,
} from '../dto/minimax-music.dto';

type MinimaxMusicRequest = {
  model: MinimaxMusicModel;
  prompt?: string;
  lyrics?: string;
  isInstrumental: boolean;
  lyricsOptimizer: boolean;
};

type MinimaxHttpResult = {
  ok: boolean;
  status: number;
  statusText: string;
  json: Record<string, any> | null;
  rawText: string;
};

export type MinimaxMusicSynthesisResult = {
  audioUrl: string;
  status: number;
  requestId?: string;
  model: MinimaxMusicModel;
  prompt?: string;
  isInstrumental: boolean;
  lyricsOptimizer: boolean;
};

@Injectable()
export class MinimaxMusicService {
  private readonly logger = new Logger(MinimaxMusicService.name);
  private readonly apiKey: string;
  private readonly apiKeyEnvName: 'NEW_API_KEY' | 'UNSET';
  private readonly endpoint: string;
  private readonly defaultModel: MinimaxMusicModel;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      (this.configService.get<string>('NEW_API_KEY') ||
       this.configService.get<string>('NEW_API_TOKEN') ||
       '').trim();
    this.apiKeyEnvName = this.apiKey ? 'NEW_API_KEY' : 'UNSET';
    const newApiBase = (
      this.configService.get<string>('NEW_API_BASE_URL') || 'http://localhost:4458'
    ).replace(/\/+$/, '');
    this.endpoint =
      this.configService.get<string>('MINIMAX_MUSIC_ENDPOINT')?.trim() ||
      `${newApiBase}/v1/music_generation`;
    this.defaultModel =
      this.normalizeModel(this.configService.get<string>('MINIMAX_MUSIC_MODEL')) || 'music-2.5+';

    const configuredTimeout = Number.parseInt(
      this.configService.get<string>('MINIMAX_MUSIC_TIMEOUT_MS') || '300000',
      10,
    );
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 300000;
  }

  async generateMusic(input: MinimaxMusicDto): Promise<MinimaxMusicSynthesisResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        '服务端未配置 NEW_API_KEY，请检查后端环境变量',
      );
    }

    const request = this.resolveMusicRequest(input);
    const payload = this.buildPayload(request);

    this.logger.log(`调用 MiniMax 音乐生成 API: ${this.endpoint}`);
    this.logger.log(
      `音乐生成请求摘要: ${JSON.stringify({
        apiKeyEnv: this.apiKeyEnvName,
        model: payload.model,
        promptLength: payload.prompt?.length || 0,
        lyricsLength: payload.lyrics?.length || 0,
        isInstrumental: payload.is_instrumental,
        lyricsOptimizer: payload.lyrics_optimizer,
        timeoutMs: this.timeoutMs,
      })}`,
    );

    const response = await this.post(payload);
    if (!response.ok) {
      this.throwHttpError(response);
    }

    const body = response.json || {};
    const baseStatusCode = Number(body?.base_resp?.status_code ?? 0);
    const baseStatusMsg = this.pickFirstString(body?.base_resp?.status_msg, body?.message);
    if (baseStatusCode !== 0) {
      this.throwBaseRespError(baseStatusCode, baseStatusMsg);
    }

    const synthesisStatus = Number(body?.data?.status);
    const audio = this.pickFirstString(body?.data?.audio, body?.audio);
    const requestId = this.pickFirstString(body?.trace_id, body?.request_id, body?.requestId);

    if (synthesisStatus === 2) {
      if (!audio) {
        throw new BadGatewayException('MiniMax 音乐生成完成但未返回音频地址');
      }
      return {
        audioUrl: audio,
        status: synthesisStatus,
        requestId,
        model: request.model,
        prompt: request.prompt,
        isInstrumental: request.isInstrumental,
        lyricsOptimizer: request.lyricsOptimizer,
      };
    }

    if (synthesisStatus === 1) {
      this.logger.warn(
        `MiniMax 音乐仍在合成中 requestId=${requestId || 'unknown'} promptLength=${
          request.prompt?.length || 0
        }`,
      );
      throw new ServiceUnavailableException(
        '音乐仍在合成中，请稍后重试（通常需要 1-3 分钟）',
      );
    }

    throw new BadGatewayException(
      `MiniMax 音乐生成返回异常状态：${
        Number.isFinite(synthesisStatus) ? synthesisStatus : 'unknown'
      }`,
    );
  }

  private resolveMusicRequest(input: MinimaxMusicDto): MinimaxMusicRequest {
    const prompt = this.normalizeText(input.prompt, 2000);
    const lyrics = this.normalizeText(input.lyrics, 3500);
    const isInstrumental = input.isInstrumental === true;
    const lyricsOptimizer = input.lyricsOptimizer === true;
    const model = this.normalizeModel(input.model) || this.defaultModel;

    if (isInstrumental && !prompt) {
      throw new BadRequestException('纯音乐模式下必须填写曲风提示词');
    }

    if (!isInstrumental && !lyrics && !lyricsOptimizer) {
      throw new BadRequestException('非纯音乐模式下请填写歌词或开启 AI 自动填词');
    }

    return {
      model,
      prompt,
      lyrics,
      isInstrumental,
      lyricsOptimizer,
    };
  }

  private buildPayload(request: MinimaxMusicRequest): Record<string, any> {
    const payload: Record<string, any> = {
      model: request.model,
      prompt: request.prompt,
      output_format: 'url',
      stream: false,
      is_instrumental: request.isInstrumental,
      lyrics_optimizer: request.lyricsOptimizer,
    };

    if (!request.isInstrumental && request.lyrics) {
      payload.lyrics = request.lyrics;
    }

    return payload;
  }

  private async post(payload: Record<string, any>): Promise<MinimaxHttpResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawText = await response.text();
      let json: Record<string, any> | null = null;
      if (rawText.trim()) {
        try {
          json = JSON.parse(rawText) as Record<string, any>;
        } catch {
          json = null;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        json,
        rawText,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn(`MiniMax 音乐生成请求超时（>${this.timeoutMs}ms）`);
        throw new GatewayTimeoutException(
          '音乐生成等待超时，请稍后重试（通常需要 1-3 分钟）',
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(`MiniMax 音乐生成请求失败：${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private throwHttpError(response: MinimaxHttpResult): never {
    const body = response.json || {};
    const code = Number(body?.base_resp?.status_code);
    const message = this.pickFirstString(
      body?.base_resp?.status_msg,
      body?.message,
      response.statusText,
      this.summarizeRawBody(response.rawText),
    );

    if (response.status === 429 || code === 1002) {
      throw new ServiceUnavailableException(`MiniMax 音乐生成限流，请稍后重试${message ? `：${message}` : ''}`);
    }

    if (response.status === 401 || code === 1004 || code === 2049) {
      throw new ServiceUnavailableException(`MiniMax API Key 无效或已过期${message ? `：${message}` : ''}`);
    }

    if (code === 1008) {
      throw new ServiceUnavailableException(`MiniMax 账户余额不足${message ? `：${message}` : ''}`);
    }

    if (response.status >= 500) {
      throw new BadGatewayException(
        `MiniMax 音乐生成上游异常（${response.status}）${message ? `：${message}` : ''}`,
      );
    }

    throw new BadGatewayException(
      `MiniMax 音乐生成失败（${response.status}）${message ? `：${message}` : ''}`,
    );
  }

  private throwBaseRespError(statusCode: number, statusMsg?: string): never {
    const suffix = statusMsg ? `：${statusMsg}` : '';
    if (statusCode === 1002) {
      throw new ServiceUnavailableException(`MiniMax 音乐生成限流，请稍后重试${suffix}`);
    }
    if (statusCode === 1004 || statusCode === 2049) {
      throw new ServiceUnavailableException(`MiniMax API Key 无效或已过期${suffix}`);
    }
    if (statusCode === 1008) {
      throw new ServiceUnavailableException(`MiniMax 账户余额不足${suffix}`);
    }
    if (statusCode === 2013) {
      throw new BadRequestException(`音乐生成参数错误${suffix}`);
    }
    throw new BadGatewayException(`MiniMax 音乐生成失败（code=${statusCode}）${suffix}`);
  }

  private normalizeModel(model?: string): MinimaxMusicModel | undefined {
    const candidate = model?.trim() as MinimaxMusicModel | undefined;
    if (!candidate) return undefined;
    return MINIMAX_MUSIC_MODELS.includes(candidate) ? candidate : undefined;
  }

  private normalizeText(value: string | undefined, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > maxLength) {
      throw new BadRequestException(`文本长度超限，最大 ${maxLength} 字`);
    }
    return trimmed;
  }

  private pickFirstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private summarizeRawBody(raw: string): string | undefined {
    const value = raw?.trim();
    if (!value) return undefined;
    if (value.length <= 300) return value;
    return `${value.slice(0, 300)}...`;
  }
}
