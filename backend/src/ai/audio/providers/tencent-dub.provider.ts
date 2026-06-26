import { Injectable } from '@nestjs/common';
import { TencentSpeechService } from '../../services/tencent-speech.service';
import {
  TencentSpeechAsyncQueryResult,
  TencentSpeechAsyncTaskResult,
  TencentSpeechDto,
} from '../../dto/tencent-speech.dto';
import { AudioGenerateDto } from '../audio-generate.dto';
import { AudioGenerateResult, IAudioProvider } from '../audio-provider.interface';

/**
 * tencent-dub（视频配音）适配器：薄封装现有 TencentSpeechService。
 * 输出同时含 audioUrl + videoUrl（配音后视频）。另透出 async 方法供异步路由委派。
 * 不重写内部逻辑；计费仍走后端固定计价（withCredits('tencent-speech')）。
 */
@Injectable()
export class TencentDubProvider implements IAudioProvider {
  readonly mode = 'tencent-dub' as const;

  constructor(private readonly service: TencentSpeechService) {}

  static toServiceDto(req: AudioGenerateDto): TencentSpeechDto {
    return {
      inputVideoUrl: req.inputVideoUrl || '',
      text: req.text,
      speakerUrl: req.speakerUrl,
      voiceId: req.voiceId,
      speakerGender: req.speakerGender,
      srcLang: req.srcLang,
      dstLangs: req.dstLangs,
      dstLang: req.dstLang,
      srcSubtitleUrl: req.srcSubtitleUrl,
      dstSubtitleUrls: req.dstSubtitleUrls,
      dstSubtitleUrl: req.dstSubtitleUrl,
      embedSubtitle: req.embedSubtitle,
      font: req.font,
      fontSize: req.fontSize,
      marginV: req.marginV,
      outputPattern: req.outputPattern,
      notifyUrl: req.notifyUrl,
    };
  }

  async generate(req: AudioGenerateDto): Promise<AudioGenerateResult> {
    const result = await this.service.synthesizeSpeech(
      TencentDubProvider.toServiceDto(req),
    );
    return {
      audioUrl: result.audioUrl || result.videoUrl || '',
      videoUrl: result.videoUrl,
      mode: 'tencent-dub',
      provider: 'tencent',
      requestId: result.requestId,
    };
  }

  /** 异步：创建配音任务（委派现有服务）。 */
  async createAsyncTask(req: AudioGenerateDto): Promise<TencentSpeechAsyncTaskResult> {
    return this.service.createAsyncSpeechTask(TencentDubProvider.toServiceDto(req));
  }

  /** 异步：查询配音任务（委派现有服务）。 */
  async queryTask(taskId: string): Promise<TencentSpeechAsyncQueryResult> {
    return this.service.queryAsyncSpeechTask(taskId);
  }
}
