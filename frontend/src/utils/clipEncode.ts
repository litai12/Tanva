import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

export function isWebCodecsMp4Supported(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window
}

/** H.264 codec string：≤720p 用 baseline 3.1，更高用 High 4.0 */
export function avcCodecString(width: number, height: number): string {
  return width * height > 1280 * 720 ? 'avc1.640028' : 'avc1.42001f'
}

export type Mp4ClipEncoder = {
  addBitmap: (bitmap: ImageBitmap, frameIndex: number) => void
  finish: () => Promise<Blob>
}

/** WebCodecs 硬件编码器：逐帧 addBitmap → finish 出 mp4。width/height 必须偶数。 */
export function createWebCodecsEncoder(opts: { width: number; height: number; fps: number; bitrate?: number }): Mp4ClipEncoder {
  const { width, height, fps } = opts
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
  })
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e },
  })
  encoder.configure({ codec: avcCodecString(width, height), width, height, bitrate: opts.bitrate ?? 6_000_000, framerate: fps })
  return {
    addBitmap: (bitmap, frameIndex) => {
      const ts = Math.round((frameIndex / fps) * 1_000_000)
      const frame = new VideoFrame(bitmap, { timestamp: ts, duration: Math.round(1_000_000 / fps) })
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 })
      frame.close()
    },
    finish: async () => {
      await encoder.flush()
      muxer.finalize()
      const { buffer } = muxer.target as ArrayBufferTarget
      return new Blob([buffer], { type: 'video/mp4' })
    },
  }
}

/**
 * ffmpeg.wasm 兜底在 Tanva 未接入（无 ffmpegCore）。WebCodecs 不支持时优雅报错，
 * 保留同名导出以免调用方改动；调用前应先用 isWebCodecsMp4Supported() 判定。
 */
export async function encodeBitmapsWithFfmpeg(_bitmaps: ImageBitmap[], _fps: number): Promise<Blob> {
  throw new Error('当前浏览器不支持 WebCodecs 视频编码，且未启用 ffmpeg 兜底，无法导出视频')
}
