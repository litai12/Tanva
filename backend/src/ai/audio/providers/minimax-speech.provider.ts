import { Injectable } from '@nestjs/common';
import { MinimaxSpeechService } from '../../services/minimax-speech.service';
import { MinimaxSpeechDto } from '../../dto/minimax-speech.dto';
import { AudioGenerateDto } from '../audio-generate.dto';
import { AudioGenerateResult, IAudioProvider } from '../audio-provider.interface';

/**
 * minimax-speech 适配器：薄封装现有 MinimaxSpeechService，把结果映射为 AudioResult。
 * 不重写内部逻辑；计费仍走后端固定计价（withCredits('minimax-speech')）。
 */
@Injectable()
export class MinimaxSpeechProvider implements IAudioProvider {
  readonly mode = 'minimax-speech' as const;

  constructor(private readonly service: MinimaxSpeechService) {}

  static toServiceDto(req: AudioGenerateDto): MinimaxSpeechDto {
    return {
      text: req.text || '',
      voiceId: req.voiceId,
      model: req.model,
      outputFormat: req.outputFormat,
      audioMode: req.audioMode,
      emotion: req.emotion,
      soundEffects: req.soundEffects,
    };
  }

  async generate(req: AudioGenerateDto): Promise<AudioGenerateResult> {
    const result = await this.service.synthesizeSpeech(
      MinimaxSpeechProvider.toServiceDto(req),
    );
    return {
      audioUrl: result.audioUrl,
      mode: 'minimax-speech',
      provider: 'minimax',
      requestId: result.requestId,
    };
  }
}
