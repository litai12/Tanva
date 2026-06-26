import { Injectable } from '@nestjs/common';
import { MinimaxMusicService } from '../../services/minimax-music.service';
import { MinimaxMusicDto } from '../../dto/minimax-music.dto';
import { AudioGenerateDto } from '../audio-generate.dto';
import { AudioGenerateResult, IAudioProvider } from '../audio-provider.interface';

/**
 * minimax-music 适配器：薄封装现有 MinimaxMusicService，把结果映射为 AudioResult。
 * 不重写内部逻辑；计费仍走后端固定计价（withCredits('minimax-music')）。
 */
@Injectable()
export class MinimaxMusicProvider implements IAudioProvider {
  readonly mode = 'minimax-music' as const;

  constructor(private readonly service: MinimaxMusicService) {}

  static toServiceDto(req: AudioGenerateDto): MinimaxMusicDto {
    return {
      prompt: req.prompt,
      lyrics: req.lyrics,
      isInstrumental: req.isInstrumental,
      lyricsOptimizer: req.lyricsOptimizer,
      model: req.musicModel,
    };
  }

  async generate(req: AudioGenerateDto): Promise<AudioGenerateResult> {
    const result = await this.service.generateMusic(
      MinimaxMusicProvider.toServiceDto(req),
    );
    return {
      audioUrl: result.audioUrl,
      mode: 'minimax-music',
      provider: 'minimax',
      requestId: result.requestId,
    };
  }
}
