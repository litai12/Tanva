import { AudioClip, MP4Clip, OffscreenSprite, Combinator } from "@webav/av-cliper";
import type { ComposeVideoSource } from "./useVideoCompose";
import { fetchClip } from "./reliableClipFetch";

export type ComposeAudioTrack = {
  url: string;
  /** 0~2，默认 1 */
  volume?: number;
  /** BGM 短于成片时循环铺底，默认 false（配音语义） */
  loop?: boolean;
  title?: string;
};

/**
 * 纯异步函数：把多个视频片段按顺序拼接成一个 MP4 Blob。
 * 不依赖 React，可在 DAG runner 等非 React 上下文中调用。
 *
 * audioTracks：上游音频节点的配音/BGM 轨，从 0 时刻起与视频混音，
 * 时长钉成片总长（音频更长则截断，loop=true 时循环铺满）。
 *
 * @throws 视频数量 < 2 时抛出；AbortSignal 触发时抛出；加载/拼接失败时抛出
 */
export async function composeVideosToBlob(
  sources: ComposeVideoSource[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    audioTracks?: ComposeAudioTrack[];
  }
): Promise<Blob> {
  if (sources.length < 2) {
    throw new Error("至少需要 2 个视频才能合成");
  }

  const signal = options?.signal;
  const onProgress = options?.onProgress;

  // 主体 clips（按 sources 顺序一一对应）
  const clips: MP4Clip[] = [];
  // split 产生的 after clips，仅用于 finally 清理，不参与迭代
  const extraClips: MP4Clip[] = [];

  try {
    for (const v of sources) {
      if (signal?.aborted) throw new Error("合成已取消");
      const res = await fetchClip(v.url, { signal });
      if (!res.body) throw new Error(`无法加载视频：${v.title || v.url}`);
      const clip = new MP4Clip(res.body);
      await clip.ready;
      clips.push(clip);
    }

    if (signal?.aborted) throw new Error("合成已取消");

    const { width, height } = clips[0].meta;

    let offset = 0;
    const sprites: OffscreenSprite[] = [];

    for (let i = 0; i < sources.length; i++) {
      const clip = clips[i];
      const src = sources[i];
      const trimStart = src.trimStart ?? 0;
      const trimEnd = src.trimEnd ?? 0;
      const originalDuration = clip.meta.duration;
      const usedDuration = Math.max(0, originalDuration - trimStart - trimEnd);
      if (usedDuration <= 0) continue;

      let workClip: MP4Clip = clip;
      if (trimStart > 0) {
        const [, after] = await clip.split(trimStart);
        extraClips.push(after);
        workClip = after;
      }

      const spr = new OffscreenSprite(workClip);
      spr.time = { offset, duration: usedDuration };
      spr.rect.w = width;
      spr.rect.h = height;
      offset += usedDuration;
      sprites.push(spr);
    }

    const combinator = new Combinator({ width, height });
    combinator.on("OutputProgress", (p: number) => {
      onProgress?.(Math.round(p * 100));
    });

    for (const spr of sprites) {
      await combinator.addSprite(spr);
    }

    // 上游音频节点的配音/BGM 轨：从 0 时刻混入，时长钉成片总长。
    const totalDuration = offset;
    for (const track of options?.audioTracks || []) {
      if (signal?.aborted) {
        combinator.destroy();
        throw new Error("合成已取消");
      }
      const res = await fetchClip(track.url, { signal });
      if (!res.body) throw new Error(`无法加载音频：${track.title || track.url}`);
      const audioClip = new AudioClip(res.body, {
        volume:
          typeof track.volume === "number"
            ? Math.min(2, Math.max(0, track.volume))
            : 1,
        loop: track.loop === true,
      });
      await audioClip.ready;
      const audioSprite = new OffscreenSprite(audioClip);
      audioSprite.time = { offset: 0, duration: totalDuration };
      await combinator.addSprite(audioSprite);
    }

    if (signal?.aborted) {
      combinator.destroy();
      throw new Error("合成已取消");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: any[] = [];
    const reader = combinator.output().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    combinator.destroy();
    return new Blob(chunks, { type: "video/mp4" });
  } finally {
    clips.forEach((c) => c.destroy());
    extraClips.forEach((c) => c.destroy());
  }
}
