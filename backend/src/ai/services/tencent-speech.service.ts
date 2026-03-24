import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import COS from 'cos-nodejs-sdk-v5';
import { OssService } from '../../oss/oss.service';
import { AIProviderFactory } from '../ai-provider.factory';
import {
  TencentSpeechAsyncQueryResult,
  TencentSpeechAsyncTaskResult,
  TencentSpeechDto,
  TencentSpeechSynthesisResult,
} from '../dto/tencent-speech.dto';

type TencentResponsePayload = Record<string, any>;

@Injectable()
export class TencentSpeechService {
  private readonly logger = new Logger(TencentSpeechService.name);
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly sessionToken?: string;
  private readonly endpoint: string;
  private readonly region: string;
  private readonly version: string;
  private readonly service = 'mps';
  private readonly definition: number;
  private readonly definitionFromEnv: boolean;
  private readonly subAppId?: number;
  private readonly outputBucket: string;
  private readonly outputRegion: string;
  private readonly outputDir: string;
  private readonly signOutputUrl: boolean;
  private readonly outputUrlExpiresSec: number;
  private readonly defaultVoiceId?: string;
  private readonly defaultSpeakerGender: 'male' | 'female';
  private readonly enableAutoTranslate: boolean;
  private readonly translationProvider?: string;
  private readonly translationModel?: string;
  private readonly cosClient?: COS;
  private readonly requestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly oss: OssService,
    private readonly aiProviderFactory: AIProviderFactory,
  ) {
    this.secretId = (this.configService.get<string>('TENCENT_MPS_SECRET_ID') || '').trim();
    this.secretKey = (this.configService.get<string>('TENCENT_MPS_SECRET_KEY') || '').trim();
    this.sessionToken =
      (this.configService.get<string>('TENCENT_MPS_SESSION_TOKEN') || '').trim() || undefined;
    this.endpoint =
      (this.configService.get<string>('TENCENT_MPS_ENDPOINT') || 'mps.tencentcloudapi.com').trim();
    this.region = (this.configService.get<string>('TENCENT_MPS_REGION') || 'ap-guangzhou').trim();
    this.version = (this.configService.get<string>('TENCENT_MPS_API_VERSION') || '2019-06-12').trim();
    const definitionRaw = (this.configService.get<string>('TENCENT_MPS_DUBBING_DEFINITION') || '').trim();
    this.definition = this.parsePositiveInt(definitionRaw, 32);
    this.definitionFromEnv = definitionRaw.length > 0;
    this.subAppId = this.parseOptionalPositiveInt(this.configService.get<string>('TENCENT_MPS_SUB_APP_ID'));
    this.outputBucket = (this.configService.get<string>('TENCENT_MPS_OUTPUT_BUCKET') || '').trim();
    this.outputRegion =
      (this.configService.get<string>('TENCENT_MPS_OUTPUT_REGION') || this.region).trim();
    this.outputDir = this.normalizeOutputDir(
      (this.configService.get<string>('TENCENT_MPS_OUTPUT_DIR') || '/mps/tencent-speech/').trim(),
    );
    this.signOutputUrl = this.parseBoolean(
      this.configService.get<string>('TENCENT_MPS_SIGN_OUTPUT_URL'),
      true,
    );
    this.outputUrlExpiresSec = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_MPS_OUTPUT_URL_EXPIRES_SEC'),
      86_400,
    );
    this.defaultVoiceId = this.normalizeVoiceId(
      this.configService.get<string>('TENCENT_MPS_DEFAULT_VOICE_ID'),
    );
    this.defaultSpeakerGender = this.normalizeSpeakerGender(
      this.configService.get<string>('TENCENT_MPS_DEFAULT_SPEAKER_GENDER'),
    );
    this.enableAutoTranslate = this.parseBoolean(
      this.configService.get<string>('TENCENT_MPS_ENABLE_AUTO_TRANSLATE'),
      true,
    );
    this.translationProvider =
      (this.configService.get<string>('TENCENT_MPS_TRANSLATION_PROVIDER') || '').trim() ||
      undefined;
    this.translationModel =
      (this.configService.get<string>('TENCENT_MPS_TRANSLATION_MODEL') || '').trim() || undefined;
    this.requestTimeoutMs = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_MPS_REQUEST_TIMEOUT_MS'),
      30_000,
    );
    this.pollIntervalMs = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_MPS_POLL_INTERVAL_MS'),
      5_000,
    );
    this.maxWaitMs = this.parsePositiveInt(
      this.configService.get<string>('TENCENT_MPS_MAX_WAIT_MS'),
      600_000,
    );
    if (this.signOutputUrl && this.secretId && this.secretKey) {
      this.cosClient = new COS({
        SecretId: this.secretId,
        SecretKey: this.secretKey,
        SecurityToken: this.sessionToken,
      });
    }
    if (!this.definitionFromEnv) {
      this.logger.warn(
        '未配置 TENCENT_MPS_DUBBING_DEFINITION，当前使用默认值 32。若腾讯控制台模板 ID 不匹配，任务可能直接 FAIL。',
      );
    }
    if (!this.defaultVoiceId) {
      this.logger.warn(
        '未配置 TENCENT_MPS_DEFAULT_VOICE_ID，text 模式将优先走字幕 URL；如需指定音色，请在节点填写 voiceId 或配置默认音色。',
      );
    }
    if (!this.enableAutoTranslate) {
      this.logger.warn(
        'TENCENT_MPS_ENABLE_AUTO_TRANSLATE=false，text 模式跨语言时不会自动翻译，请改用 subtitleUrls 模式传入目标字幕。',
      );
    }
  }

  async synthesizeSpeech(input: TencentSpeechDto): Promise<TencentSpeechSynthesisResult> {
    const task = await this.createAsyncSpeechTask(input);
    const deadline = Date.now() + this.maxWaitMs;
    let lastStatus: string | undefined = task.status;

    while (Date.now() < deadline) {
      const queryResult = await this.queryAsyncSpeechTask(task.taskId);
      lastStatus = queryResult.status || lastStatus;

      // 某些返回会出现状态字段不一致（例如 FAIL 但已返回输出 URL），此时以可播放媒体存在为准。
      if (queryResult.audioUrl || queryResult.videoUrl) {
        return queryResult;
      }

      if (this.isSuccessStatus(queryResult.status)) {
        return queryResult;
      }

      if (this.isFailureStatus(queryResult.status)) {
        let failReason = queryResult.failReason;
        if (!failReason) {
          try {
            await this.sleep(800);
            const detailResult = await this.queryAsyncSpeechTask(queryResult.taskId || task.taskId);
            failReason = detailResult.failReason || failReason;
          } catch {
            // ignore detail query errors, keep original fallback hints
          }
        }
        const reason = this.resolveFailureHint(failReason);
        this.logger.warn(
          `腾讯语音任务失败 taskId=${queryResult.taskId || task.taskId}, status=${
            queryResult.status || 'FAILED'
          }, reason=${reason || 'N/A'}, requestId=${queryResult.requestId || 'N/A'}`,
        );
        throw new BadGatewayException(
          `腾讯语音任务失败：${queryResult.status || 'FAILED'}${
            reason ? `，原因：${reason}` : ''
          }（taskId: ${queryResult.taskId || task.taskId}${
            queryResult.requestId ? `, requestId: ${queryResult.requestId}` : ''
          }）`,
        );
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new ServiceUnavailableException(
      `腾讯语音任务超时（>${Math.ceil(this.maxWaitMs / 1000)}s），最后状态：${
        lastStatus || 'UNKNOWN'
      }`,
    );
  }

  async createAsyncSpeechTask(input: TencentSpeechDto): Promise<TencentSpeechAsyncTaskResult> {
    const preparedInput = await this.prepareTextModeInput(input);
    this.ensureConfigReady();
    const request = this.buildProcessMediaRequest(preparedInput);
    const resolvedVoiceId = this.resolveVoiceId(preparedInput.voiceId);
    this.logger.debug(
      `腾讯语音提交任务: inputVideoUrl=${preparedInput.inputVideoUrl}, speakerUrl=${
        preparedInput.speakerUrl ? 'yes' : 'no'
      }, srcSubtitleUrl=${preparedInput.srcSubtitleUrl || 'N/A'}, dstSubtitleUrl=${
        preparedInput.dstSubtitleUrl || 'N/A'
      }, srcLang=${preparedInput.srcLang || 'N/A'}, dstLang=${preparedInput.dstLang || 'N/A'}, definition=${
        this.definition
      }, voiceId=${resolvedVoiceId || 'N/A'}, outputBucket=${this.outputBucket}, outputRegion=${
        this.outputRegion
      }, outputDir=${this.outputDir}`,
    );
    const payload = await this.callTencentApi('ProcessMedia', request);
    const response = this.extractResponse(payload);
    const taskId =
      this.pickFirstString(
        response?.TaskId,
        response?.taskId,
        response?.WorkflowTask?.TaskId,
      ) || this.findFirstStringByKeys(response, ['TaskId', 'taskId']);

    if (!taskId) {
      throw new BadGatewayException('腾讯语音任务创建成功但未返回 TaskId');
    }

    const status =
      this.pickFirstString(
        response?.Status,
        response?.TaskStatus,
        response?.WorkflowTask?.Status,
      ) || undefined;
    const requestId = this.pickFirstString(response?.RequestId, response?.requestId);

    return { taskId, status, requestId };
  }

  async queryAsyncSpeechTask(taskId: string): Promise<TencentSpeechAsyncQueryResult> {
    this.ensureCredentialReady();
    const normalizedTaskId = (taskId || '').trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required');
    }

    const body: Record<string, any> = { TaskId: normalizedTaskId };
    if (typeof this.subAppId === 'number') {
      body.SubAppId = this.subAppId;
    }

    const payload = await this.callTencentApi('DescribeTaskDetail', body);
    const response = this.extractResponse(payload);
    const requestId = this.pickFirstString(response?.RequestId, response?.requestId);
    const workflowTask =
      this.pickFirstObject(
        response?.WorkflowTask,
        response?.WorkFlowTask,
        response?.TaskDetail?.WorkflowTask,
        response?.TaskDetail?.WorkFlowTask,
      ) || {};

    const aiAnalysisSet =
      this.pickFirstArray(
        workflowTask?.AiAnalysisResultSet,
        workflowTask?.AIAnalysisResultSet,
        response?.AiAnalysisResultSet,
      ) || [];
    const dubbingWrapper = aiAnalysisSet.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, any>;
      if (candidate.DubbingTask || candidate.dubbingTask) return true;
      const type = this.pickFirstString(candidate.Type, candidate.TaskType);
      return typeof type === 'string' && type.toLowerCase().includes('dubbing');
    }) as Record<string, any> | undefined;
    const dubbingTask = this.pickFirstObject(
      dubbingWrapper?.DubbingTask,
      dubbingWrapper?.dubbingTask,
      dubbingWrapper,
    );
    const output =
      this.pickFirstObject(
        dubbingTask?.Output,
        dubbingWrapper?.Output,
        workflowTask?.Output,
        response?.Output,
      ) || {};

    const resolvedTaskId =
      this.pickFirstString(
        response?.TaskId,
        workflowTask?.TaskId,
        response?.TaskDetail?.TaskId,
      ) ||
      this.findFirstStringByKeys(response, ['TaskId']) ||
      normalizedTaskId;
    const status =
      this.pickFirstString(
        dubbingTask?.Status,
        dubbingWrapper?.Status,
        workflowTask?.Status,
        response?.Status,
        response?.TaskStatus,
      ) ||
      this.findFirstStringByKeys(response, ['Status', 'TaskStatus']) ||
      undefined;

    const outputStorage = this.resolveOutputCosStorage(output);

    const rawResolvedAudioUrl = this.normalizeUrl(
      this.findFirstStringByKeys(output, [
        'OutputAudioUrl',
        'AudioUrl',
        'DubbingAudioUrl',
        'MediaAudioUrl',
        'PlayAudioUrl',
        'FileAudioUrl',
        'audioUrl',
        'audio_url',
      ]),
    );
    const rawResolvedVideoUrl = this.normalizeUrl(
      this.findFirstStringByKeys(output, [
        'OutputVideoUrl',
        'VideoUrl',
        'DubbingVideoUrl',
        'MediaVideoUrl',
        'PlayVideoUrl',
        'FileVideoUrl',
        'OutputMediaUrl',
        'MediaUrl',
        'PlayUrl',
        'OutputUrl',
        'DownloadUrl',
        'videoUrl',
        'video_url',
      ]),
    );
    const resolvedAudioUrl = this.ensureSignedOutputHttpUrl(rawResolvedAudioUrl, 'audio', outputStorage);
    const resolvedVideoUrl = this.ensureSignedOutputHttpUrl(rawResolvedVideoUrl, 'video', {
      ...outputStorage,
      allowUnknownExtension: true,
    });
    const explicitAudioPath = this.findFirstStringByKeys(output, [
      'AudioPath',
      'OutputAudioPath',
      'DubbingAudioPath',
    ]);
    const explicitVideoPath = this.findFirstStringByKeys(output, [
      'VideoPath',
      'OutputVideoPath',
      'DubbingVideoPath',
      'VideoObject',
      'VideoObjectKey',
    ]);
    const explicitSpeakerPath = this.findFirstStringByKeys(output, [
      'SpeakerPath',
      'OutputSpeakerPath',
      'DubbingSpeakerPath',
    ]);
    const audioUrl =
      resolvedAudioUrl ||
      this.normalizeCosObjectToHttpUrl(explicitAudioPath, 'audio', outputStorage) ||
      this.findFirstPlayableMediaUrl([output], 'audio') ||
      this.findFirstPlayableCosObjectUrl([output], 'audio', outputStorage);
    const videoUrl =
      resolvedVideoUrl ||
      this.normalizeCosObjectToHttpUrl(explicitVideoPath, 'video', {
        ...outputStorage,
        allowUnknownExtension: true,
      }) ||
      this.findFirstPlayableMediaUrl([output], 'video') ||
      this.findFirstPlayableCosObjectUrl([output], 'video', outputStorage);
    const rawSpeakerUrl = this.normalizeUrl(
      this.findFirstStringByKeys(output, [
        'OutputSpeakerUrl',
        'SpeakerUrl',
        'DubbingSpeakerUrl',
        'speakerUrl',
        'speaker_url',
      ]) ||
        this.normalizeCosObjectToHttpUrl(explicitSpeakerPath, 'speaker', {
          ...outputStorage,
          allowUnknownExtension: true,
        }) ||
        this.findFirstStringByKeys(response, [
          'OutputSpeakerUrl',
          'SpeakerUrl',
          'DubbingSpeakerUrl',
          'speakerUrl',
          'speaker_url',
        ]),
    );
    const speakerUrl = this.ensureSignedOutputHttpUrl(rawSpeakerUrl, 'speaker', {
      ...outputStorage,
      allowUnknownExtension: true,
    });

    // 某些返回仅包含视频 URL；为了兼容语音节点输出，回退到视频 URL 作为可播放媒体地址。
    const compatibleAudioUrl = audioUrl || videoUrl;
    if ((status || '').trim().toLowerCase() === 'success' && !compatibleAudioUrl) {
      this.logger.warn(
        `腾讯语音任务成功但未解析到媒体 URL taskId=${resolvedTaskId}, requestId=${requestId || 'N/A'}, outputKeys=${
          this.listTopLevelKeys(output).join(',') || 'N/A'
        }, videoPath=${explicitVideoPath || 'N/A'}, audioPath=${explicitAudioPath || 'N/A'}, outputBucket=${
          outputStorage.bucket || 'N/A'
        }, outputRegion=${outputStorage.region || 'N/A'}, speakerPath=${explicitSpeakerPath || 'N/A'}`,
      );
    }
    const failReason = this.normalizeFailureReason(
      this.extractFailureReason(
      response,
      workflowTask,
      dubbingWrapper,
      dubbingTask,
      output,
      ),
    );

    return {
      taskId: resolvedTaskId,
      status,
      requestId,
      audioUrl: compatibleAudioUrl,
      videoUrl,
      speakerUrl,
      failReason,
      output,
    };
  }

  private buildProcessMediaRequest(input: TencentSpeechDto): Record<string, any> {
    const inputVideoUrl = this.requireHttpUrl(input.inputVideoUrl, 'inputVideoUrl');
    const dubbing = this.buildDubbingParameters(input);

    const payload: Record<string, any> = {
      InputInfo: {
        Type: 'URL',
        UrlInputInfo: {
          Url: inputVideoUrl,
        },
      },
      OutputStorage: {
        Type: 'COS',
        CosOutputStorage: {
          Bucket: this.outputBucket,
          Region: this.outputRegion,
        },
      },
      OutputDir: this.outputDir,
      AiAnalysisTask: {
        Definition: this.definition,
        ExtendedParameter: JSON.stringify({ dubbing }),
      },
    };

    const notifyUrl = this.normalizeUrl(input.notifyUrl);
    if (notifyUrl) {
      payload.TaskNotifyConfig = {
        NotifyType: 'URL',
        NotifyUrl: notifyUrl,
      };
    }

    if (typeof this.subAppId === 'number') {
      payload.SubAppId = this.subAppId;
    }

    return payload;
  }

  private buildDubbingParameters(input: TencentSpeechDto): Record<string, any> {
    const dubbing: Record<string, any> = {};
    const speakerUrl = this.normalizeUrl(input.speakerUrl);

    if (speakerUrl) {
      dubbing.speakerUrl = speakerUrl;
    } else {
      const srcSubtitleUrl = this.normalizeUrl(input.srcSubtitleUrl);
      if (!srcSubtitleUrl) {
        throw new BadRequestException(
          '需要提供 speakerUrl，或提供 text，或提供 srcSubtitleUrl + 目标字幕（dstSubtitleUrls/dstSubtitleUrl）',
        );
      }

      const dstSubtitleUrls = this.resolveDstSubtitleUrls(input);
      if (Object.keys(dstSubtitleUrls).length === 0) {
        throw new BadRequestException('subtitleUrls 模式下至少需要一个目标字幕 URL');
      }

      const srcLang = this.normalizeLangCode(input.srcLang) || 'zh';
      const dstLangs = this.resolveDstLangs(input, dstSubtitleUrls);

      dubbing.srcLang = srcLang;
      dubbing.dstLangs = dstLangs;
      dubbing.subtitleUrls = {
        srcSubtitleUrl,
        dstSubtitleUrls,
      };
    }

    const subtitle = this.buildSubtitleConfig(input);
    if (subtitle) {
      dubbing.subtitle = subtitle;
    }

    const outputPattern = (input.outputPattern || '').trim();
    if (outputPattern) {
      dubbing.outputPattern = outputPattern;
    }

    return dubbing;
  }

  private async prepareTextModeInput(input: TencentSpeechDto): Promise<TencentSpeechDto> {
    const speakerUrl = this.normalizeUrl(input.speakerUrl);
    const srcSubtitleUrl = this.normalizeUrl(input.srcSubtitleUrl);
    const dstSubtitleUrls = this.resolveDstSubtitleUrls(input);
    const hasReadySubtitleMode = Boolean(srcSubtitleUrl) && Object.keys(dstSubtitleUrls).length > 0;
    if (speakerUrl || hasReadySubtitleMode) {
      return input;
    }

    const text = this.normalizeInputText(input.text);
    if (!text) {
      return input;
    }

    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException('text 模式需要 OSS，可先配置 OSS_* 环境变量');
    }

    const srcLang = this.normalizeLangCode(input.srcLang) || 'zh';
    const dstLang = this.resolveSingleDstLang(input, srcLang);
    const subtitleSegments = this.splitSubtitleSegments(text);
    if (subtitleSegments.length === 0) {
      throw new BadRequestException('text 不能为空');
    }
    const translatedSegments = await this.resolveTargetSegments(subtitleSegments, srcLang, dstLang);

    const resolvedVoiceId = this.resolveVoiceId(input.voiceId);
    if (resolvedVoiceId) {
      const speakerGender = this.resolveSpeakerGender(input.speakerGender);
      const speakerDocument = this.buildSpeakerDocument(
        subtitleSegments,
        translatedSegments,
        srcLang,
        dstLang,
        resolvedVoiceId,
        speakerGender,
      );
      const uploaded = await this.uploadGeneratedSpeakerFile(speakerDocument);
      this.logger.debug(
        `腾讯语音 text 模式 speaker 已生成: srcLang=${srcLang}, dstLang=${dstLang}, autoTranslated=${
          srcLang === dstLang ? 'no' : 'yes'
        }, voiceId=${resolvedVoiceId}, speakerUrl=${uploaded.speakerUrl}`,
      );

      return {
        ...input,
        srcLang,
        dstLang,
        dstLangs: [dstLang],
        voiceId: resolvedVoiceId,
        speakerGender,
        speakerUrl: uploaded.speakerUrl,
      };
    }

    const srcSrt = this.buildSrtFromSegments(subtitleSegments);
    const dstSrt = this.buildSrtFromSegments(translatedSegments);
    const uploaded = await this.uploadGeneratedSubtitlePair(srcSrt, dstSrt, srcLang, dstLang);
    this.logger.debug(
      `腾讯语音 text 模式字幕已生成: srcLang=${srcLang}, dstLang=${dstLang}, autoTranslated=${
        srcLang === dstLang ? 'no' : 'yes'
      }, srcSubtitleUrl=${uploaded.srcSubtitleUrl}, dstSubtitleUrl=${uploaded.dstSubtitleUrl}`,
    );

    return {
      ...input,
      srcLang,
      dstLang,
      dstLangs: [dstLang],
      srcSubtitleUrl: uploaded.srcSubtitleUrl,
      dstSubtitleUrl: uploaded.dstSubtitleUrl,
      dstSubtitleUrls: {
        ...(input.dstSubtitleUrls || {}),
        [dstLang]: uploaded.dstSubtitleUrl,
      },
    };
  }

  private normalizeInputText(value?: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/\r\n?/g, '\n').trim();
    return normalized || undefined;
  }

  private splitSubtitleSegments(text: string): string[] {
    const normalized = text.replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').trim();
    if (!normalized) return [];

    const chunks: string[] = [];
    for (const rawLine of normalized.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const sentenceChunks = this.splitLineByPunctuation(line);
      if (sentenceChunks.length === 0) {
        this.pushSplitByMaxLength(chunks, line, 28);
        continue;
      }
      for (const sentence of sentenceChunks) {
        this.pushSplitByMaxLength(chunks, sentence, 28);
      }
    }
    return chunks;
  }

  private splitLineByPunctuation(line: string): string[] {
    const parts = line.split(/([。！？!?；;，,])/);
    const chunks: string[] = [];
    for (let index = 0; index < parts.length; index += 2) {
      const phrase = (parts[index] || '').trim();
      const punctuation = (parts[index + 1] || '').trim();
      const merged = `${phrase}${punctuation}`.trim();
      if (merged) {
        chunks.push(merged);
      }
    }
    return chunks;
  }

  private pushSplitByMaxLength(target: string[], input: string, maxLength: number): void {
    const value = (input || '').trim();
    if (!value) return;
    const chars = Array.from(value);
    if (chars.length <= maxLength) {
      target.push(value);
      return;
    }

    for (let start = 0; start < chars.length; start += maxLength) {
      const chunk = chars.slice(start, start + maxLength).join('').trim();
      if (chunk) {
        target.push(chunk);
      }
    }
  }

  private buildSrtFromSegments(segments: string[]): string {
    const lines: string[] = [];
    let currentStartSeconds = 0;

    for (let index = 0; index < segments.length; index += 1) {
      const text = segments[index];
      const durationSeconds = this.estimateClipDurationSeconds(text);
      const startSeconds = currentStartSeconds;
      const endSeconds = startSeconds + durationSeconds;

      lines.push(
        `${index + 1}`,
        `${this.formatSrtTimestamp(startSeconds)} --> ${this.formatSrtTimestamp(endSeconds)}`,
        text,
        '',
      );

      currentStartSeconds = endSeconds + 0.12;
    }

    return `${lines.join('\n').trim()}\n`;
  }

  private buildSpeakerDocument(
    srcSegments: string[],
    dstSegments: string[],
    srcLang: string,
    dstLang: string,
    voiceId: string,
    speakerGender: 'male' | 'female',
  ): Record<string, any> {
    const speakerId = 'speaker_0';
    const clips: Array<Record<string, any>> = [];
    let currentStartSeconds = 0;

    for (let index = 0; index < srcSegments.length; index += 1) {
      const srcText = srcSegments[index];
      const dstText = dstSegments[index] || srcText;
      const durationSeconds = this.estimateClipDurationSeconds(srcText);
      const startSeconds = currentStartSeconds;
      const endSeconds = startSeconds + durationSeconds;

      clips.push({
        TextStartTime: this.formatSpeakerTimestamp(startSeconds),
        TextEndTime: this.formatSpeakerTimestamp(endSeconds),
        SpeakerId: speakerId,
        SrcText: srcText,
        DstTexts: {
          [dstLang]: dstText,
        },
      });

      currentStartSeconds = endSeconds + 0.12;
    }

    return {
      SrcLang: srcLang,
      DstLangs: [dstLang],
      Speakers: [
        {
          Id: speakerId,
          Gender: speakerGender,
          VoiceId: voiceId,
        },
      ],
      Clips: clips,
    };
  }

  private formatSrtTimestamp(totalSeconds: number): string {
    const totalMs = Math.max(0, Math.floor(totalSeconds * 1000));
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const seconds = Math.floor((totalMs % 60_000) / 1000);
    const milliseconds = totalMs % 1000;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  private formatSpeakerTimestamp(totalSeconds: number): string {
    const totalMs = Math.max(0, Math.floor(totalSeconds * 1000));
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const seconds = Math.floor((totalMs % 60_000) / 1000);
    const milliseconds = totalMs % 1000;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      seconds,
    ).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  private estimateClipDurationSeconds(text: string): number {
    const textLength = Math.max(1, Array.from(text).length);
    return Math.max(1.2, Math.min(6, textLength * 0.22));
  }

  private async uploadGeneratedSubtitlePair(
    srcSrt: string,
    dstSrt: string,
    srcLang: string,
    dstLang: string,
  ): Promise<{ srcSubtitleUrl: string; dstSubtitleUrl: string }> {
    const outputPrefix = this.outputDir.replace(/^\/+|\/+$/g, '');
    const subtitleDir = outputPrefix
      ? `${outputPrefix}/subtitle-inputs`
      : 'mps/tencent-speech/subtitle-inputs';
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = crypto.randomBytes(6).toString('hex');
    const baseName = `${Date.now()}-${randomPart}`;

    const srcKey = `${subtitleDir}/${datePart}/${baseName}-src-${srcLang}.srt`;
    const dstKey = `${subtitleDir}/${datePart}/${baseName}-dst-${dstLang}.srt`;

    const contentType = 'application/x-subrip; charset=utf-8';
    const srcUploaded = await this.oss.putBuffer(srcKey, Buffer.from(srcSrt, 'utf8'), contentType);
    const dstUploaded = await this.oss.putBuffer(dstKey, Buffer.from(dstSrt, 'utf8'), contentType);
    const srcSubtitleUrl = this.normalizeUrl(srcUploaded.url);
    const dstSubtitleUrl = this.normalizeUrl(dstUploaded.url);

    if (!srcSubtitleUrl || !dstSubtitleUrl) {
      throw new ServiceUnavailableException('自动上传字幕到 OSS 失败，请检查 OSS 配置');
    }

    return { srcSubtitleUrl, dstSubtitleUrl };
  }

  private async uploadGeneratedSpeakerFile(
    speaker: Record<string, any>,
  ): Promise<{ speakerUrl: string }> {
    const outputPrefix = this.outputDir.replace(/^\/+|\/+$/g, '');
    const speakerDir = outputPrefix
      ? `${outputPrefix}/speaker-inputs`
      : 'mps/tencent-speech/speaker-inputs';
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = crypto.randomBytes(6).toString('hex');
    const baseName = `${Date.now()}-${randomPart}`;
    const key = `${speakerDir}/${datePart}/${baseName}-speaker.json`;

    const contentType = 'application/json; charset=utf-8';
    const uploaded = await this.oss.putBuffer(
      key,
      Buffer.from(JSON.stringify(speaker), 'utf8'),
      contentType,
    );
    const speakerUrl = this.normalizeUrl(uploaded.url);
    if (!speakerUrl) {
      throw new ServiceUnavailableException('自动上传 speaker 到 OSS 失败，请检查 OSS 配置');
    }

    return { speakerUrl };
  }

  private buildSubtitleConfig(input: TencentSpeechDto): Record<string, any> | null {
    const subtitle: Record<string, any> = {};
    if (typeof input.embedSubtitle === 'boolean') {
      subtitle.embed = input.embedSubtitle;
    }

    const style: Record<string, any> = {};
    const font = (input.font || '').trim();
    if (font && font.toLowerCase() !== 'auto') {
      style.font = font;
    }
    if (typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)) {
      style.fontSize = input.fontSize;
    }
    if (typeof input.marginV === 'number' && Number.isFinite(input.marginV)) {
      style.marginV = input.marginV;
    }
    if (Object.keys(style).length > 0) {
      subtitle.style = style;
    }

    return Object.keys(subtitle).length > 0 ? subtitle : null;
  }

  private resolveSingleDstLang(input: TencentSpeechDto, fallback: string): string {
    const single = this.normalizeLangCode(input.dstLang);
    if (single) return single;
    if (Array.isArray(input.dstLangs)) {
      for (const item of input.dstLangs) {
        const normalized = this.normalizeLangCode(item);
        if (normalized) return normalized;
      }
    }
    return fallback;
  }

  private async resolveTargetSegments(
    sourceSegments: string[],
    srcLang: string,
    dstLang: string,
  ): Promise<string[]> {
    if (srcLang === dstLang) {
      return [...sourceSegments];
    }
    if (!this.enableAutoTranslate) {
      throw new BadRequestException(
        `text 模式跨语言（${srcLang} -> ${dstLang}）未开启自动翻译，请改用 subtitleUrls 模式传入目标字幕 URL`,
      );
    }

    const provider = this.aiProviderFactory.getProvider(this.translationModel, this.translationProvider);
    if (!provider || !provider.isAvailable()) {
      throw new ServiceUnavailableException(
        `text 模式跨语言（${srcLang} -> ${dstLang}）需要自动翻译，但当前翻译模型不可用`,
      );
    }

    const prompt = this.buildTranslationPrompt(sourceSegments, srcLang, dstLang);
    const translateResult = await provider.generateText({
      prompt,
      model: this.translationModel,
      enableWebSearch: false,
    });
    if (!translateResult.success || !translateResult.data?.text?.trim()) {
      throw new ServiceUnavailableException(
        `text 模式自动翻译失败（${srcLang} -> ${dstLang}），请稍后重试或改用 subtitleUrls 模式`,
      );
    }

    const translated = this.parseTranslatedSegments(translateResult.data.text, sourceSegments.length);
    this.logger.debug(
      `腾讯语音 text 模式自动翻译完成: ${srcLang} -> ${dstLang}, segments=${sourceSegments.length}, provider=${
        this.translationProvider || 'default'
      }, model=${this.translationModel || 'default'}`,
    );
    return translated;
  }

  private buildTranslationPrompt(segments: string[], srcLang: string, dstLang: string): string {
    const payload = JSON.stringify(
      segments.map((text, index) => ({ index: index + 1, text })),
      null,
      2,
    );
    return [
      `You are a professional subtitle translator.`,
      `Translate each item from language code "${srcLang}" to "${dstLang}".`,
      `Rules:`,
      `1. Keep item count unchanged.`,
      `2. Keep original order unchanged.`,
      `3. Keep punctuation and tone natural for dubbing subtitles.`,
      `4. Return ONLY a JSON array of strings, no markdown, no explanation.`,
      `5. Each translated item should be concise and suitable for spoken dubbing.`,
      ``,
      `Input JSON:`,
      payload,
    ].join('\n');
  }

  private parseTranslatedSegments(rawText: string, expectedCount: number): string[] {
    const normalized = this.unwrapCodeFence(rawText);
    const parsed = this.tryParseTranslatedSegmentsJson(normalized, expectedCount);
    if (parsed) return parsed;

    const plainLines = normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\d+\s*[).:：-]\s*/, '').trim())
      .filter(Boolean);

    if (plainLines.length === expectedCount) {
      return plainLines;
    }

    throw new ServiceUnavailableException(
      `自动翻译结果解析失败，期望 ${expectedCount} 条字幕，实际 ${plainLines.length} 条`,
    );
  }

  private tryParseTranslatedSegmentsJson(
    input: string,
    expectedCount: number,
  ): string[] | undefined {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return this.normalizeTranslatedItems(parsed, expectedCount);
      }
      if (parsed && typeof parsed === 'object') {
        const candidateKeys = ['translations', 'result', 'items', 'data'];
        for (const key of candidateKeys) {
          const value = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(value)) {
            const normalized = this.normalizeTranslatedItems(value, expectedCount);
            if (normalized) return normalized;
          }
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeTranslatedItems(
    items: unknown[],
    expectedCount: number,
  ): string[] | undefined {
    if (!Array.isArray(items) || items.length !== expectedCount) return undefined;
    const normalized = items
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const candidate =
            (typeof record.text === 'string' && record.text) ||
            (typeof record.translation === 'string' && record.translation) ||
            (typeof record.targetText === 'string' && record.targetText) ||
            '';
          return candidate.trim();
        }
        return '';
      })
      .filter((text) => text.length > 0);
    return normalized.length === expectedCount ? normalized : undefined;
  }

  private unwrapCodeFence(input: string): string {
    const trimmed = (input || '').trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
  }

  private resolveDstSubtitleUrls(input: TencentSpeechDto): Record<string, string> {
    const map: Record<string, string> = {};
    if (input.dstSubtitleUrls && typeof input.dstSubtitleUrls === 'object') {
      for (const [lang, value] of Object.entries(input.dstSubtitleUrls)) {
        const normalizedLang = this.normalizeLangCode(lang);
        const normalizedUrl = this.normalizeUrl(value);
        if (normalizedLang && normalizedUrl) {
          map[normalizedLang] = normalizedUrl;
        }
      }
    }

    const singleDstSubtitleUrl = this.normalizeUrl(input.dstSubtitleUrl);
    if (singleDstSubtitleUrl) {
      const fallbackLang =
        this.normalizeLangCode(input.dstLang) ||
        this.normalizeLangCode(Array.isArray(input.dstLangs) ? input.dstLangs[0] : undefined) ||
        'en';
      if (!map[fallbackLang]) {
        map[fallbackLang] = singleDstSubtitleUrl;
      }
    }

    return map;
  }

  private resolveDstLangs(
    input: TencentSpeechDto,
    dstSubtitleUrls: Record<string, string>,
  ): string[] {
    const fromDto = Array.isArray(input.dstLangs)
      ? input.dstLangs
          .map((item) => this.normalizeLangCode(item))
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
    const single = this.normalizeLangCode(input.dstLang);
    if (single) {
      fromDto.push(single);
    }
    if (fromDto.length > 0) {
      return Array.from(new Set(fromDto));
    }
    return Object.keys(dstSubtitleUrls);
  }

  private async callTencentApi(action: string, payload: Record<string, any>): Promise<TencentResponsePayload> {
    this.ensureCredentialReady();
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const authorization = this.buildAuthorization(action, body, timestamp, date);
    const url = `https://${this.endpoint}`;

    const headers: Record<string, string> = {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: this.endpoint,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': this.version,
      'X-TC-Region': this.region,
    };
    if (this.sessionToken) {
      headers['X-TC-Token'] = this.sessionToken;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new BadGatewayException(
          `腾讯 MPS ${action} 请求失败: ${response.status} ${response.statusText}${
            rawText ? ` - ${rawText}` : ''
          }`,
        );
      }

      let parsed: TencentResponsePayload;
      try {
        parsed = rawText ? (JSON.parse(rawText) as TencentResponsePayload) : {};
      } catch {
        throw new BadGatewayException(`腾讯 MPS ${action} 返回了无法解析的 JSON`);
      }

      const responsePayload = this.extractResponse(parsed);
      const upstreamError = this.pickFirstObject(responsePayload?.Error, responsePayload?.error);
      if (upstreamError) {
        const code = this.pickFirstString(upstreamError?.Code, upstreamError?.code);
        const message = this.pickFirstString(upstreamError?.Message, upstreamError?.message);
        this.throwTencentUpstreamError(action, code, message);
      }

      return parsed;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException(`腾讯 MPS ${action} 请求超时`);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`腾讯 MPS ${action} 请求异常: ${message}`);
      throw new ServiceUnavailableException(`腾讯 MPS ${action} 请求异常: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildAuthorization(
    action: string,
    requestPayload: string,
    timestamp: number,
    date: string,
  ): string {
    const canonicalHeaders =
      `content-type:application/json; charset=utf-8\n` +
      `host:${this.endpoint}\n` +
      `x-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const hashedPayload = this.sha256Hex(requestPayload);
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const stringToSign =
      `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${this.sha256Hex(canonicalRequest)}`;

    const secretDate = this.hmac(`TC3${this.secretKey}`, date);
    const secretService = this.hmac(secretDate, this.service);
    const secretSigning = this.hmac(secretService, 'tc3_request');
    const signature = this.hmac(secretSigning, stringToSign).toString('hex');

    return (
      `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
    );
  }

  private sha256Hex(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private hmac(key: string | Buffer, content: string): Buffer {
    return crypto.createHmac('sha256', key).update(content).digest();
  }

  private extractResponse(payload: TencentResponsePayload): TencentResponsePayload {
    if (payload?.Response && typeof payload.Response === 'object') {
      return payload.Response as TencentResponsePayload;
    }
    if (payload?.response && typeof payload.response === 'object') {
      return payload.response as TencentResponsePayload;
    }
    return payload || {};
  }

  private ensureConfigReady(): void {
    this.ensureCredentialReady();
    if (!this.outputBucket) {
      throw new ServiceUnavailableException('TENCENT_MPS_OUTPUT_BUCKET is not configured');
    }
    if (!this.outputRegion) {
      throw new ServiceUnavailableException('TENCENT_MPS_OUTPUT_REGION is not configured');
    }
  }

  private ensureCredentialReady(): void {
    if (!this.secretId || !this.secretKey) {
      throw new ServiceUnavailableException(
        'Tencent MPS credentials are not configured (TENCENT_MPS_SECRET_ID/TENCENT_MPS_SECRET_KEY)',
      );
    }
  }

  private throwTencentUpstreamError(action: string, code?: string, message?: string): never {
    const normalizedCode = (code || '').trim();
    const normalizedMessage = (message || '').trim();
    const suffix = [normalizedCode, normalizedMessage].filter(Boolean).join(': ');

    if (
      normalizedCode.startsWith('InvalidParameter') ||
      normalizedCode.startsWith('MissingParameter') ||
      normalizedCode.startsWith('UnsupportedOperation')
    ) {
      throw new BadRequestException(`腾讯 MPS ${action} 参数错误${suffix ? `（${suffix}）` : ''}`);
    }

    if (normalizedCode === 'AuthFailure.SignatureFailure' || normalizedCode === 'AuthFailure.SecretIdNotFound') {
      throw new ServiceUnavailableException(
        `腾讯 MPS 凭证不可用${suffix ? `（${suffix}）` : ''}`,
      );
    }

    throw new BadGatewayException(`腾讯 MPS ${action} 调用失败${suffix ? `（${suffix}）` : ''}`);
  }

  private normalizeOutputDir(value: string): string {
    const trimmed = (value || '').trim();
    if (!trimmed) return 'mps/tencent-speech/';
    const noLeadingSlash = trimmed.replace(/^\/+/, '');
    return noLeadingSlash.endsWith('/') ? noLeadingSlash : `${noLeadingSlash}/`;
  }

  private normalizeUrl(value?: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
      return url.toString();
    } catch {
      return undefined;
    }
  }

  private requireHttpUrl(value: string, fieldName: string): string {
    const normalized = this.normalizeUrl(value);
    if (!normalized) {
      throw new BadRequestException(`${fieldName} must be a valid http(s) URL`);
    }
    return normalized;
  }

  private normalizeLangCode(value?: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return undefined;
    return trimmed;
  }

  private listTopLevelKeys(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.keys(value as Record<string, unknown>);
  }

  private resolveOutputCosStorage(value: unknown): {
    bucket?: string;
    region?: string;
    allowUnknownExtension?: boolean;
  } {
    const root = this.pickFirstObject<Record<string, any>>(value) || {};
    const outputStorage =
      this.pickFirstObject<Record<string, any>>(root.OutputStorage, root.outputStorage) || {};
    const cosStorage =
      this.pickFirstObject<Record<string, any>>(
        outputStorage.CosOutputStorage,
        outputStorage.cosOutputStorage,
      ) || outputStorage;

    const bucket = this.pickFirstString(
      cosStorage.Bucket,
      cosStorage.bucket,
      outputStorage.Bucket,
      outputStorage.bucket,
      root.Bucket,
      root.bucket,
      this.outputBucket,
    );
    const region = this.pickFirstString(
      cosStorage.Region,
      cosStorage.region,
      outputStorage.Region,
      outputStorage.region,
      root.Region,
      root.region,
      this.outputRegion,
    );

    return { bucket, region };
  }

  private findFirstPlayableMediaUrl(scopes: unknown[], mediaType: 'audio' | 'video'): string | undefined {
    for (const scope of scopes) {
      const candidate = this.findFirstStringByPredicate(scope, (text) => {
        const url = this.normalizeUrl(text);
        if (!url) return false;
        return this.hasMediaExtension(url, mediaType);
      });
      const normalized = this.normalizeUrl(candidate);
      if (normalized) return normalized;
    }
    return undefined;
  }

  private findFirstPlayableCosObjectUrl(
    scopes: unknown[],
    mediaType: 'audio' | 'video' | 'speaker',
    options?: {
      bucket?: string;
      region?: string;
      allowUnknownExtension?: boolean;
    },
  ): string | undefined {
    const objectKeyNames = [
      'OutputObject',
      'OutputObjectKey',
      'Object',
      'ObjectKey',
      'Key',
      'AudioPath',
      'VideoPath',
      'SpeakerPath',
      'FilePath',
      'Path',
      'StoragePath',
      'TargetPath',
      'MediaPath',
    ];
    for (const scope of scopes) {
      const candidate = this.findFirstStringByKeys(scope, objectKeyNames);
      const normalized = this.normalizeCosObjectToHttpUrl(candidate, mediaType, options);
      if (normalized) return normalized;
    }
    return undefined;
  }

  private ensureSignedOutputHttpUrl(
    value: string | undefined,
    mediaType: 'audio' | 'video' | 'speaker',
    options?: {
      bucket?: string;
      region?: string;
      allowUnknownExtension?: boolean;
    },
  ): string | undefined {
    const normalized = this.normalizeUrl(value);
    if (!normalized) return undefined;
    if (!this.signOutputUrl || !this.cosClient) return normalized;

    try {
      const url = new URL(normalized);
      const hostMatch = url.hostname.match(/^([^.]+)\.cos\.([^.]+)\.myqcloud\.com$/i);
      if (!hostMatch) return normalized;
      const bucket = (options?.bucket || hostMatch[1] || '').trim();
      const region = (options?.region || hostMatch[2] || '').trim();
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!bucket || !region || !key) return normalized;
      if (!(options?.allowUnknownExtension === true) && !this.hasMediaExtension(key, mediaType)) {
        return normalized;
      }
      return this.buildSignedCosUrl(bucket, region, key) || normalized;
    } catch {
      return normalized;
    }
  }

  private buildSignedCosUrl(bucket: string, region: string, key: string): string | undefined {
    if (!this.cosClient || !this.signOutputUrl) return undefined;
    try {
      return this.cosClient.getObjectUrl({
        Bucket: bucket,
        Region: region,
        Key: key,
        Sign: true,
        Expires: this.outputUrlExpiresSec,
        Protocol: 'https:',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`腾讯 COS 输出链接签名失败: ${message}`);
      return undefined;
    }
  }

  private normalizeCosObjectToHttpUrl(
    value: string | undefined,
    mediaType: 'audio' | 'video' | 'speaker',
    options?: {
      bucket?: string;
      region?: string;
      allowUnknownExtension?: boolean;
    },
  ): string | undefined {
    const raw = (value || '').trim();
    if (!raw) return undefined;
    const bucket = (options?.bucket || this.outputBucket || '').trim();
    const region = (options?.region || this.outputRegion || '').trim();
    const allowUnknownExtension = options?.allowUnknownExtension === true;

    const asHttpUrl = this.normalizeUrl(raw);
    if (asHttpUrl && (allowUnknownExtension || this.hasMediaExtension(asHttpUrl, mediaType))) {
      return this.ensureSignedOutputHttpUrl(asHttpUrl, mediaType, options) || asHttpUrl;
    }

    if (raw.toLowerCase().startsWith('cos://')) {
      const withoutScheme = raw.slice(6);
      const slashIndex = withoutScheme.indexOf('/');
      if (slashIndex <= 0) return undefined;
      const cosBucket = withoutScheme.slice(0, slashIndex).trim();
      const objectKey = withoutScheme.slice(slashIndex + 1).trim().replace(/^\/+/, '');
      if (!cosBucket || !objectKey) return undefined;
      if (!allowUnknownExtension && !this.hasMediaExtension(objectKey, mediaType)) return undefined;
      if (!region) return undefined;
      const unsigned = `https://${cosBucket}.cos.${region}.myqcloud.com/${encodeURI(objectKey)}`;
      return this.buildSignedCosUrl(cosBucket, region, objectKey) || unsigned;
    }

    let objectKey = raw.replace(/^\/+/, '');
    if (bucket && objectKey.startsWith(`${bucket}/`)) {
      objectKey = objectKey.slice(bucket.length + 1);
    }
    if (!objectKey) return undefined;
    if (!allowUnknownExtension && !this.hasMediaExtension(objectKey, mediaType)) return undefined;
    if (!bucket || !region) return undefined;
    const unsigned = `https://${bucket}.cos.${region}.myqcloud.com/${encodeURI(objectKey)}`;
    return this.buildSignedCosUrl(bucket, region, objectKey) || unsigned;
  }

  private hasMediaExtension(value: string, mediaType: 'audio' | 'video' | 'speaker'): boolean {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) return false;
    const extensions =
      mediaType === 'video'
        ? ['.mp4', '.mov', '.mkv', '.webm', '.m3u8', '.flv', '.avi', '.wmv', '.mxf']
        : mediaType === 'audio'
        ? ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']
        : ['.json', '.txt', '.srt', '.vtt'];
    return extensions.some((ext) => normalized.includes(ext));
  }

  private resolveVoiceId(value?: string): string | undefined {
    return this.normalizeVoiceId(value) || this.defaultVoiceId;
  }

  private normalizeVoiceId(value?: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private resolveSpeakerGender(value?: unknown): 'male' | 'female' {
    return this.normalizeSpeakerGender(value);
  }

  private normalizeSpeakerGender(value?: unknown): 'male' | 'female' {
    if (typeof value !== 'string') return this.defaultSpeakerGender || 'male';
    const normalized = value.trim().toLowerCase();
    return normalized === 'female' ? 'female' : 'male';
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt((value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
  }

  private parseOptionalPositiveInt(value: string | undefined): number | undefined {
    const parsed = Number.parseInt((value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  }

  private isSuccessStatus(status?: string): boolean {
    const normalized = (status || '').trim().toLowerCase();
    return ['success', 'succeeded', 'finish', 'finished', 'done', 'completed', 'complete', 'ok'].includes(
      normalized,
    );
  }

  private isFailureStatus(status?: string): boolean {
    const normalized = (status || '').trim().toLowerCase();
    return ['fail', 'failed', 'error', 'cancel', 'cancelled', 'timeout', 'exception'].includes(
      normalized,
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private pickFirstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private pickFirstObject<T extends Record<string, any>>(...values: unknown[]): T | undefined {
    for (const value of values) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as T;
      }
    }
    return undefined;
  }

  private pickFirstArray<T = any>(...values: unknown[]): T[] | undefined {
    for (const value of values) {
      if (Array.isArray(value)) return value as T[];
    }
    return undefined;
  }

  private findFirstStringByKeys(root: unknown, keys: string[]): string | undefined {
    if (!root || typeof root !== 'object') return undefined;
    const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
    const queue: unknown[] = [root];
    const visited = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
        if (normalizedKeys.has(key.toLowerCase()) && typeof value === 'string' && value.trim()) {
          return value.trim();
        }
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return undefined;
  }

  private findFirstStringByPredicate(
    root: unknown,
    predicate: (value: string) => boolean,
  ): string | undefined {
    if (!root || typeof root !== 'object') return undefined;
    const queue: unknown[] = [root];
    const visited = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      for (const value of Object.values(current as Record<string, unknown>)) {
        if (typeof value === 'string' && predicate(value.trim())) {
          return value.trim();
        }
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return undefined;
  }

  private extractFailureReason(...scopes: unknown[]): string | undefined {
    const preferredKeys = [
      'FailReason',
      'FailedReason',
      'ErrorMessage',
      'ErrMessage',
      'ErrMsg',
      'StatusMessage',
      'Detail',
      'Reason',
      'Message',
      'ErrorCodeExt',
      'ErrCodeExt',
      'Code',
    ];

    for (const scope of scopes) {
      const value = this.findFirstStringByKeys(scope, preferredKeys);
      if (!value) continue;
      const normalized = value.trim();
      if (!normalized) continue;
      if (
        ['fail', 'failed', 'error', 'failure', 'unknown'].includes(
          normalized.toLowerCase(),
        )
      ) {
        continue;
      }
      return normalized;
    }
    return undefined;
  }

  private normalizeFailureReason(value?: string): string | undefined {
    const normalized = (value || '').trim();
    if (!normalized) return undefined;
    const lower = normalized.toLowerCase();
    if (
      [
        'success',
        'succeed',
        'succeeded',
        'ok',
        'done',
        'finish',
        'finished',
        'complete',
        'completed',
      ].includes(lower)
    ) {
      return undefined;
    }
    return normalized;
  }

  private resolveFailureHint(value?: string): string | undefined {
    const normalized = this.normalizeFailureReason(value);
    if (normalized) {
      return normalized;
    }
    const hints: string[] = [];
    if (!this.definitionFromEnv) {
      hints.push('未配置 TENCENT_MPS_DUBBING_DEFINITION（当前默认 32，常见导致 FAIL）');
    }
    if (!this.defaultVoiceId) {
      hints.push('若输入视频无原音轨，建议配置 voiceId（节点或 TENCENT_MPS_DEFAULT_VOICE_ID）走 speaker 模式');
    }
    hints.push('请确认 TENCENT_MPS_OUTPUT_BUCKET/REGION 可写且与密钥账号匹配');
    hints.push('请确认 inputVideoUrl 与字幕 URL 可被腾讯公网直接访问');
    return hints.join('；');
  }
}
