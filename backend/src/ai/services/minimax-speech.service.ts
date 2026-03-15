import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MINIMAX_AUDIO_MODES,
  MINIMAX_SOUND_EFFECTS,
  MINIMAX_SPEECH_EMOTIONS,
  MINIMAX_SPEECH_OUTPUT_FORMATS,
  MinimaxSpeechAudioMode,
  MinimaxSpeechDto,
  MinimaxSpeechEmotion,
  MinimaxSpeechOutputFormat,
  MinimaxSpeechSoundEffect,
} from '../dto/minimax-speech.dto';

type MinimaxSpeechApiErrorPayload = {
  error?: {
    code?: string;
    type?: string;
    message?: string;
  };
  message?: string;
};

type MinimaxSpeechAttemptError = {
  status: number;
  statusText: string;
  errorCode?: string;
  errorType?: string;
  errorMessage?: string;
  rawBody: string;
};

type MinimaxSpeechRequest = {
  text: string;
  model: string;
  voiceId: string;
  voiceAlias?: string;
  emotion?: MinimaxSpeechEmotion;
  soundEffects: MinimaxSpeechSoundEffect[];
  outputFormat: MinimaxSpeechOutputFormat;
  audioMode: MinimaxSpeechAudioMode;
};

type MinimaxHttpResult = {
  status: number;
  statusText: string;
  contentType: string;
  buffer: Buffer;
  json: Record<string, any> | null;
};

type MinimaxSpeechAudioResult = {
  audioUrl: string;
  requestId?: string;
};

type MinimaxVoiceAliasTarget = {
  voiceId: string;
  emotion?: MinimaxSpeechEmotion;
};

export type MinimaxSpeechSynthesisResult = {
  audioUrl: string;
  outputFormat: MinimaxSpeechOutputFormat;
  voiceId: string;
  voiceAlias?: string;
  emotion?: MinimaxSpeechEmotion;
  requestId?: string;
  model: string;
};

export type MinimaxSpeechAsyncTaskResult = {
  taskId: string;
  status?: string;
  requestId?: string;
  voiceId: string;
  voiceAlias?: string;
  emotion?: MinimaxSpeechEmotion;
  model: string;
};

export type MinimaxSpeechAsyncQueryResult = {
  taskId: string;
  status?: string;
  requestId?: string;
  audioUrl?: string;
};

@Injectable()
export class MinimaxSpeechService {
  private readonly logger = new Logger(MinimaxSpeechService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultVoiceId = 'male-qn-qingse';
  private readonly defaultOutputFormat: MinimaxSpeechOutputFormat;
  private readonly defaultAudioMode: MinimaxSpeechAudioMode;
  private readonly voiceAliasMap: Record<string, MinimaxVoiceAliasTarget>;
  private static readonly LEGACY_MODEL_ALIASES: Record<string, string> = {
    'speech-01': 'speech-2.6-hd',
    'speech-01-hd': 'speech-2.6-hd',
  };
  private static readonly BUILTIN_VOICE_ALIASES: Record<string, MinimaxVoiceAliasTarget> = {
    alloy: { voiceId: 'female-chengshu' },
    echo: { voiceId: 'male-qn-qingse' },
    fable: { voiceId: 'male-qn-jingying' },
    onyx: { voiceId: 'presenter_male' },
    nova: { voiceId: 'presenter_female' },
    shimmer: { voiceId: 'audiobook_female_1' },
  };

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('MINIMAX_API_KEY') || '';
    this.baseUrl = this.configService.get<string>('MINIMAX_BASE_URL')?.trim() ||
                   this.configService.get<string>('KAPON_BASE_URL')?.trim() ||
                   'https://models.kapon.cloud';
    this.defaultModel =
      this.configService.get<string>('MINIMAX_SPEECH_MODEL')?.trim() || 'speech-2.6-hd';
    this.defaultOutputFormat =
      this.normalizeOutputFormat(this.configService.get<string>('MINIMAX_SPEECH_OUTPUT_FORMAT')) ||
      'url';
    this.defaultAudioMode =
      this.normalizeAudioMode(this.configService.get<string>('MINIMAX_SPEECH_AUDIO_MODE')) ||
      'json';
    this.voiceAliasMap = {
      ...MinimaxSpeechService.BUILTIN_VOICE_ALIASES,
      ...this.parseCustomVoiceAliases(
        this.configService.get<string>('MINIMAX_VOICE_ALIAS_MAP') ||
          this.configService.get<string>('MINIMAX_VOICE_ALIAS_JSON'),
      ),
    };
  }

  async synthesizeSpeech(input: MinimaxSpeechDto): Promise<MinimaxSpeechSynthesisResult> {
    const url = `${this.baseUrl}/minimaxi/v1/t2a_v2`;
    const request = this.resolveSpeechRequest(input);
    const modelCandidates = this.buildModelCandidates(request.model);
    let lastError: MinimaxSpeechAttemptError | null = null;

    this.logger.log(`调用 MiniMax API: ${url}`);
    this.logger.log(
      `参数: ${JSON.stringify({
        text: request.text,
        voiceId: request.voiceId,
        voiceAlias: request.voiceAlias,
        emotion: request.emotion,
        soundEffects: request.soundEffects,
        model: request.model,
        outputFormat: request.outputFormat,
        audioMode: request.audioMode,
      })}`,
    );

    for (const candidateModel of modelCandidates) {
      if (lastError) {
        this.logger.warn(
          `MiniMax 语音模型回退重试: ${lastError.errorCode || lastError.statusText} -> ${candidateModel || 'API default model'}`,
        );
      }

      const body = this.buildSpeechPayload(request, candidateModel);
      this.logger.log(`实际发送的 payload: ${JSON.stringify(body)}`);
      const response = await this.post(url, body);

      if (response.status < 200 || response.status >= 300) {
        const attemptError = this.buildAttemptError(response);
        lastError = attemptError;
        this.logger.error(
          `MiniMax API 错误: ${attemptError.status} ${attemptError.rawBody || attemptError.statusText}`,
        );

        if (!this.shouldRetryWithFallback(attemptError, candidateModel)) {
          break;
        }
        continue;
      }

      const audioResult = this.extractAudioResult(response, request.outputFormat);
      if (audioResult) {
        return {
          audioUrl: audioResult.audioUrl,
          outputFormat: request.outputFormat,
          voiceId: request.voiceId,
          voiceAlias: request.voiceAlias,
          emotion: request.emotion,
          requestId: audioResult.requestId,
          model: candidateModel || request.model,
        };
      }

      lastError = this.buildInvalidResponseError(response, 'MiniMax response missing audio payload');
      this.logger.error(`MiniMax API 响应缺少可用音频: ${lastError.rawBody}`);
      break;
    }

    this.throwUpstreamError('语音合成', lastError);
  }

  async createAsyncSpeechTask(input: MinimaxSpeechDto): Promise<MinimaxSpeechAsyncTaskResult> {
    const url = `${this.baseUrl}/minimaxi/v1/t2a_async_v2`;
    const request = this.resolveSpeechRequest(input);
    const modelCandidates = this.buildModelCandidates(request.model);
    let lastError: MinimaxSpeechAttemptError | null = null;

    this.logger.log(`调用 MiniMax Async API: ${url}`);

    for (const candidateModel of modelCandidates) {
      if (lastError) {
        this.logger.warn(
          `MiniMax Async 语音模型回退重试: ${lastError.errorCode || lastError.statusText} -> ${candidateModel || 'API default model'}`,
        );
      }

      const body = this.buildSpeechPayload(request, candidateModel);
      const response = await this.post(url, body);

      if (response.status < 200 || response.status >= 300) {
        const attemptError = this.buildAttemptError(response);
        lastError = attemptError;
        this.logger.error(
          `MiniMax Async API 错误: ${attemptError.status} ${attemptError.rawBody || attemptError.statusText}`,
        );
        if (!this.shouldRetryWithFallback(attemptError, candidateModel)) {
          break;
        }
        continue;
      }

      const data = response.json || {};
      const taskId = this.pickFirstString(
        data?.data?.task_id,
        data?.task_id,
        data?.data?.taskId,
        data?.taskId,
        data?.data?.id,
        data?.id,
      );
      if (!taskId) {
        lastError = this.buildInvalidResponseError(
          response,
          'MiniMax async response missing task id',
        );
        this.logger.error(`MiniMax Async API 响应缺少 task id: ${lastError.rawBody}`);
        break;
      }

      const status = this.pickFirstString(data?.data?.status, data?.status, data?.task_status);
      const requestId = this.extractRequestId(data);
      return {
        taskId,
        status,
        requestId,
        voiceId: request.voiceId,
        voiceAlias: request.voiceAlias,
        emotion: request.emotion,
        model: candidateModel || request.model,
      };
    }

    this.throwUpstreamError('异步语音合成', lastError);
  }

  async queryAsyncSpeechTask(taskId: string): Promise<MinimaxSpeechAsyncQueryResult> {
    const sanitizedTaskId = taskId?.trim();
    if (!sanitizedTaskId) {
      throw new Error('MiniMax async query requires taskId');
    }

    const url = new URL(`${this.baseUrl}/minimaxi/v1/query/t2a_async_query_v2`);
    url.searchParams.set('task_id', sanitizedTaskId);
    const response = await this.get(url.toString());

    if (response.status < 200 || response.status >= 300) {
      const attemptError = this.buildAttemptError(response);
      this.logger.error(
        `MiniMax Async Query 错误: ${attemptError.status} ${attemptError.rawBody || attemptError.statusText}`,
      );
      this.throwUpstreamError('异步任务查询', attemptError);
    }

    const data = response.json || {};
    const status = this.pickFirstString(
      data?.data?.status,
      data?.status,
      data?.task_status,
      data?.data?.task_status,
    );
    const requestId = this.extractRequestId(data);
    const taskIdFromBody =
      this.pickFirstString(
        data?.data?.task_id,
        data?.task_id,
        data?.data?.taskId,
        data?.taskId,
      ) || sanitizedTaskId;

    const audioResult = this.extractAudioResult(response, this.defaultOutputFormat);
    return {
      taskId: taskIdFromBody,
      status,
      requestId,
      audioUrl: audioResult?.audioUrl,
    };
  }

  private resolveSpeechRequest(input: MinimaxSpeechDto): MinimaxSpeechRequest {
    const text = (input.text || '').trim();
    if (!text) {
      throw new Error('MiniMax speech text is required');
    }

    const voice = this.resolveVoice(input.voiceId, input.emotion);
    return {
      text,
      model: this.normalizeModel(input.model),
      voiceId: voice.voiceId,
      voiceAlias: voice.voiceAlias,
      emotion: voice.emotion,
      soundEffects: this.normalizeSoundEffects(input.soundEffects),
      outputFormat: this.normalizeOutputFormat(input.outputFormat) || this.defaultOutputFormat,
      audioMode: this.normalizeAudioMode(input.audioMode) || this.defaultAudioMode,
    };
  }

  private resolveVoice(
    voiceId?: string,
    emotion?: string,
  ): { voiceId: string; voiceAlias?: string; emotion?: MinimaxSpeechEmotion } {
    const requestedVoice = (voiceId || '').trim() || this.defaultVoiceId;
    const requestedEmotion = this.normalizeEmotion(emotion);
    const parsedVoice = this.parseVoiceAliasValue(requestedVoice);
    if (!parsedVoice) {
      return { voiceId: this.defaultVoiceId, emotion: requestedEmotion };
    }

    const aliasTarget = this.voiceAliasMap[parsedVoice.voiceId.toLowerCase()];
    if (aliasTarget) {
      return {
        voiceId: aliasTarget.voiceId,
        voiceAlias: requestedVoice,
        emotion: requestedEmotion || aliasTarget.emotion || parsedVoice.emotion,
      };
    }

    return {
      voiceId: parsedVoice.voiceId,
      emotion: requestedEmotion || parsedVoice.emotion,
    };
  }

  private buildSpeechPayload(
    request: MinimaxSpeechRequest,
    model?: string,
  ): Record<string, any> {
    const body: Record<string, any> = {
      model: model || request.model,
      text: request.text,
      output_format: request.outputFormat,
      voice_setting: {
        voice_id: request.voiceId,
      },
    };

    if (request.emotion) {
      body.voice_setting.emotion = request.emotion;
    }

    if (request.soundEffects.length > 0) {
      const effectsString = Array.isArray(request.soundEffects)
        ? request.soundEffects.join(',')
        : String(request.soundEffects);

      if (effectsString.trim()) {
        body.voice_modify = {
          sound_effects: effectsString,
        };
      }
    }

    return body;
  }

  private buildModelCandidates(model: string): Array<string | undefined> {
    const candidates: Array<string | undefined> = [model];
    if (model !== this.defaultModel) {
      candidates.push(this.defaultModel);
    }
    candidates.push(undefined);

    const seen = new Set<string>();
    const deduped: Array<string | undefined> = [];
    for (const candidate of candidates) {
      const key = candidate || '__api_default__';
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(candidate);
    }
    return deduped;
  }

  private async post(url: string, body: Record<string, any>): Promise<MinimaxHttpResult> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });

    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const location = response.headers.get('location');
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).toString();
        this.logger.log(`跟随重定向 ${response.status}: ${redirectUrl}`);
        const redirectResponse = await fetch(redirectUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        return this.readHttpResult(redirectResponse);
      }
    }

    return this.readHttpResult(response);
  }

  private async get(url: string): Promise<MinimaxHttpResult> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
    });
    return this.readHttpResult(response);
  }

  private async readHttpResult(response: Response): Promise<MinimaxHttpResult> {
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const json = this.tryParseJsonBuffer(buffer);
    return {
      status: response.status,
      statusText: response.statusText,
      contentType,
      buffer,
      json,
    };
  }

  private extractAudioResult(
    response: MinimaxHttpResult,
    outputFormat: MinimaxSpeechOutputFormat,
  ): MinimaxSpeechAudioResult | null {
    if (response.json) {
      const audioResultFromJson = this.extractAudioFromJson(response.json, outputFormat);
      if (audioResultFromJson) return audioResultFromJson;
    }

    // audio_mode=hex + output_format=hex 时，渠道可能直接返回裸音频流
    if (
      response.buffer.length > 0 &&
      (response.contentType.startsWith('audio/') || !response.json)
    ) {
      const mime = this.resolveAudioMime(response.contentType, outputFormat);
      return {
        audioUrl: `data:${mime};base64,${response.buffer.toString('base64')}`,
        requestId: response.json ? this.extractRequestId(response.json) : undefined,
      };
    }

    return null;
  }

  private extractAudioFromJson(
    data: Record<string, any>,
    outputFormat: MinimaxSpeechOutputFormat,
  ): MinimaxSpeechAudioResult | null {
    const candidate = this.pickFirstString(
      data?.data?.audio,
      data?.audio,
      data?.data?.audio_url,
      data?.audio_url,
      data?.data?.audioUrl,
      data?.audioUrl,
      data?.data?.file_url,
      data?.file_url,
      data?.data?.url,
      data?.url,
    );
    if (!candidate) return null;

    const value = candidate.trim();
    if (!value) return null;

    const requestId = this.extractRequestId(data);
    if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) {
      return { audioUrl: value, requestId };
    }

    if (this.isLikelyHex(value)) {
      const compactHex = value.replace(/\s+/g, '');
      const mime = this.resolveAudioMime('', outputFormat);
      const buffer = Buffer.from(compactHex, 'hex');
      return { audioUrl: `data:${mime};base64,${buffer.toString('base64')}`, requestId };
    }

    if (this.isLikelyBase64(value)) {
      const mime = this.resolveAudioMime('', outputFormat);
      const compactBase64 = value.replace(/\s+/g, '');
      return { audioUrl: `data:${mime};base64,${compactBase64}`, requestId };
    }

    return null;
  }

  private resolveAudioMime(contentType: string, outputFormat: MinimaxSpeechOutputFormat): string {
    const fromHeader = (contentType || '').split(';')[0].trim().toLowerCase();
    if (fromHeader.startsWith('audio/')) return fromHeader;
    if (outputFormat === 'url') return 'audio/mpeg';
    return 'audio/mpeg';
  }

  private isLikelyHex(value: string): boolean {
    const compact = value.replace(/\s+/g, '');
    if (!compact || compact.length % 2 !== 0) return false;
    return /^[0-9a-fA-F]+$/.test(compact);
  }

  private isLikelyBase64(value: string): boolean {
    const compact = value.replace(/\s+/g, '');
    if (compact.length < 32 || compact.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  }

  private normalizeModel(model?: string): string {
    const candidate = model?.trim();
    if (!candidate) return this.defaultModel;
    return MinimaxSpeechService.LEGACY_MODEL_ALIASES[candidate.toLowerCase()] || candidate;
  }

  private normalizeOutputFormat(value?: string): MinimaxSpeechOutputFormat | undefined {
    const candidate = value?.trim().toLowerCase();
    if (!candidate) return undefined;
    return MINIMAX_SPEECH_OUTPUT_FORMATS.includes(candidate as MinimaxSpeechOutputFormat)
      ? (candidate as MinimaxSpeechOutputFormat)
      : undefined;
  }

  private normalizeAudioMode(value?: string): MinimaxSpeechAudioMode | undefined {
    const candidate = value?.trim().toLowerCase();
    if (!candidate) return undefined;
    return MINIMAX_AUDIO_MODES.includes(candidate as MinimaxSpeechAudioMode)
      ? (candidate as MinimaxSpeechAudioMode)
      : undefined;
  }

  private normalizeEmotion(value?: string): MinimaxSpeechEmotion | undefined {
    const candidate = value?.trim().toLowerCase();
    if (!candidate) return undefined;
    return MINIMAX_SPEECH_EMOTIONS.includes(candidate as MinimaxSpeechEmotion)
      ? (candidate as MinimaxSpeechEmotion)
      : undefined;
  }

  private normalizeSoundEffects(values?: string[]): MinimaxSpeechSoundEffect[] {
    if (!Array.isArray(values) || values.length === 0) return [];
    return values
      .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
      .filter((item): item is MinimaxSpeechSoundEffect =>
        MINIMAX_SOUND_EFFECTS.includes(item as MinimaxSpeechSoundEffect),
      );
  }

  private parseVoiceAliasValue(value: string): MinimaxVoiceAliasTarget | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    const [rawVoiceId, rawEmotion] = trimmed.split('|').map((part) => part.trim());
    if (!rawVoiceId) return null;
    return {
      voiceId: rawVoiceId,
      emotion: this.normalizeEmotion(rawEmotion),
    };
  }

  private parseCustomVoiceAliases(
    raw?: string,
  ): Record<string, MinimaxVoiceAliasTarget> {
    if (!raw?.trim()) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return {};
      const result: Record<string, MinimaxVoiceAliasTarget> = {};
      Object.entries(parsed).forEach(([alias, target]) => {
        const normalizedAlias = alias.trim().toLowerCase();
        if (!normalizedAlias) return;
        const parsedTarget = this.parseCustomVoiceAliasTarget(target);
        if (parsedTarget) result[normalizedAlias] = parsedTarget;
      });
      return result;
    } catch (error) {
      this.logger.warn(
        `解析 MINIMAX_VOICE_ALIAS_MAP 失败，忽略自定义别名: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {};
    }
  }

  private parseCustomVoiceAliasTarget(target: unknown): MinimaxVoiceAliasTarget | null {
    if (typeof target === 'string') {
      return this.parseVoiceAliasValue(target);
    }
    if (target && typeof target === 'object') {
      const value = target as Record<string, unknown>;
      const voiceId =
        (typeof value.voiceId === 'string' && value.voiceId.trim()) ||
        (typeof value.voice_id === 'string' && value.voice_id.trim()) ||
        (typeof value.voice === 'string' && value.voice.trim()) ||
        '';
      if (!voiceId) return null;
      return {
        voiceId,
        emotion: this.normalizeEmotion(
          typeof value.emotion === 'string' ? value.emotion : undefined,
        ),
      };
    }
    return null;
  }

  private shouldRetryWithFallback(
    error: MinimaxSpeechAttemptError,
    currentModel?: string,
  ): boolean {
    if (!currentModel) return false;
    // transient upstream errors: retry once with API default model as a resilience fallback.
    if (error.status === 429 || error.status >= 500) return true;
    if (error.status !== 404 && error.status !== 400) return false;
    const normalized = `${error.errorCode || ''} ${error.errorType || ''} ${error.errorMessage || ''} ${
      error.rawBody || ''
    }`.toLowerCase();
    return (
      normalized.includes('model_not_found') ||
      normalized.includes('model_routing_error') ||
      normalized.includes('无任何可用渠道')
    );
  }

  private buildAttemptError(response: MinimaxHttpResult): MinimaxSpeechAttemptError {
    const payload = (response.json || null) as MinimaxSpeechApiErrorPayload | null;
    const rawText = this.httpResultToText(response);
    return {
      status: response.status,
      statusText: response.statusText,
      errorCode: payload?.error?.code,
      errorType: payload?.error?.type,
      errorMessage: payload?.error?.message || payload?.message,
      rawBody: this.summarizeRawBody(rawText),
    };
  }

  private buildInvalidResponseError(
    response: MinimaxHttpResult,
    message: string,
  ): MinimaxSpeechAttemptError {
    return {
      status: response.status || 200,
      statusText: response.statusText || 'OK',
      errorCode: 'INVALID_RESPONSE',
      errorType: 'invalid_response',
      errorMessage: message,
      rawBody: this.summarizeRawBody(this.httpResultToText(response)),
    };
  }

  private tryParseJsonBuffer(buffer: Buffer): Record<string, any> | null {
    const text = buffer.toString('utf8').trim();
    if (!text) return null;
    try {
      return JSON.parse(text) as Record<string, any>;
    } catch {
      return null;
    }
  }

  private httpResultToText(result: MinimaxHttpResult): string {
    if (result.json) {
      try {
        return JSON.stringify(result.json);
      } catch {
        return '[json stringify failed]';
      }
    }
    return result.buffer.toString('utf8').trim();
  }

  private extractRequestId(data: Record<string, any>): string | undefined {
    return this.pickFirstString(
      data?.request_id,
      data?.requestId,
      data?.data?.request_id,
      data?.data?.requestId,
      data?.error?.request_id,
      data?.error?.requestId,
    );
  }

  private pickFirstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private summarizeRawBody(raw: string): string {
    const input = raw?.trim();
    if (!input) return '';

    if (/<html[\s>]/i.test(input)) {
      const title = input.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim();
      if (title) return `[html] ${title}`;
      return '[html] upstream gateway page';
    }

    const compact = input.replace(/\s+/g, ' ');
    if (compact.length <= 500) return compact;
    return `${compact.slice(0, 500)}...`;
  }

  private throwUpstreamError(context: string, lastError: MinimaxSpeechAttemptError | null): never {
    const fallbackMessage = `${context}失败，请稍后重试`;
    if (!lastError) {
      throw new BadGatewayException(fallbackMessage);
    }

    const status = lastError.status || 502;
    const detail = this.pickFirstString(lastError.errorMessage, lastError.errorCode, lastError.statusText);

    if (status === 429) {
      throw new ServiceUnavailableException(
        `MiniMax 服务限流（429），请稍后重试${detail ? `：${detail}` : ''}`,
      );
    }

    if (status >= 500) {
      throw new BadGatewayException(
        `MiniMax 上游服务异常（${status}），请稍后重试${detail ? `：${detail}` : ''}`,
      );
    }

    throw new BadGatewayException(
      `MiniMax 请求失败（${status}）${detail ? `：${detail}` : ''}`,
    );
  }
}
