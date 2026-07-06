/**
 * 统一音频提供商接口。
 *
 * 收编 seed-audio(豆包) / minimax-speech / minimax-music / tencent-dub / upload，
 * 让控制器只面向一个 `IAudioProvider`，由 `AudioRoutingService` 按 `mode` 路由。
 *
 * 计费说明：seed-audio 走 new-api 单轨计费——provider 把 new-api 通过响应头
 * `X-NewApi-Consumed-Credits` 回报的实际积分透出到 `consumedCredits`，由控制器
 * 的 `withCreditsFromGateway` 后扣。其余 mode 仍走后端 `credits.config` 固定计费。
 */

export type AudioMode =
  | 'seed-audio'
  | 'minimax-speech'
  | 'minimax-music'
  | 'tencent-dub'
  | 'upload';

/**
 * 统一音频结果。`videoUrl` 仅 tencent-dub(视频配音) 会返回。
 */
export interface AudioResult {
  audioUrl: string;
  videoUrl?: string;
  durationSec?: number;
  mode: AudioMode;
  provider: string;
  requestId?: string;
}

/**
 * 调用上下文（来自请求/控制器），provider 可选消费。
 */
export interface AudioGenerateContext {
  userId?: string | null;
  teamId?: string;
  projectId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * provider.generate 的返回：在 `AudioResult` 之上附带 `consumedCredits`，
 * 供网关单轨计费桥读取（非网关 provider 不设置此字段）。
 */
export type AudioGenerateResult = AudioResult & {
  /** new-api 回报的本次实际消耗积分（单轨计费）。非网关 provider 不返回。 */
  consumedCredits?: number;
};

export interface IAudioProvider {
  readonly mode: AudioMode;
  generate(
    req: import('./audio-generate.dto').AudioGenerateDto,
    ctx?: AudioGenerateContext,
  ): Promise<AudioGenerateResult>;
}
