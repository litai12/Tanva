import { BadRequestException, Injectable } from '@nestjs/common';
import { AudioMode, IAudioProvider } from './audio-provider.interface';
import { SeedAudioProvider } from './providers/seed-audio.provider';
import { MinimaxSpeechProvider } from './providers/minimax-speech.provider';
import { MinimaxMusicProvider } from './providers/minimax-music.provider';
import { TencentDubProvider } from './providers/tencent-dub.provider';

/**
 * 按 mode 路由到对应音频 provider。`upload` 由前端处理（无服务端 provider），
 * 未知 mode 抛 BadRequestException。
 */
@Injectable()
export class AudioRoutingService {
  private readonly providers: Map<AudioMode, IAudioProvider>;

  constructor(
    private readonly seedAudio: SeedAudioProvider,
    private readonly minimaxSpeech: MinimaxSpeechProvider,
    private readonly minimaxMusic: MinimaxMusicProvider,
    private readonly tencentDub: TencentDubProvider,
  ) {
    this.providers = new Map<AudioMode, IAudioProvider>([
      [seedAudio.mode, seedAudio],
      [minimaxSpeech.mode, minimaxSpeech],
      [minimaxMusic.mode, minimaxMusic],
      [tencentDub.mode, tencentDub],
    ]);
  }

  resolve(mode: AudioMode): IAudioProvider {
    const provider = this.providers.get(mode);
    if (!provider) {
      throw new BadRequestException(`不支持的音频模式: ${mode}`);
    }
    return provider;
  }

  /** 直接拿到 tencent-dub provider（异步路由用）。 */
  tencent(): TencentDubProvider {
    return this.tencentDub;
  }
}
