import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { OssService } from "../../oss/oss.service";
import type OSS from "ali-oss";

interface VideoWatermarkOptions {
  text?: string;
  timeoutMs?: number;
  ossKey?: string;
}

// 水印图片路径（与图片水印使用相同的水印图）
const WATERMARK_IMAGE_PATH = path.resolve(
  __dirname,
  "../../../../frontend/public/tanvas_ai.png"
);
// 水印相对于视频短边的比例（视频水印需要更大一些）
const WATERMARK_SCALE = 1.8;
// 水印距离边缘的距离（像素，与图片水印保持一致）
const WATERMARK_MARGIN = 25;
// 水印透明度 (0-1，与图片水印保持一致)
const WATERMARK_OPACITY = 0.7;

@Injectable()
export class VideoWatermarkService {
  private readonly logger = new Logger(VideoWatermarkService.name);
  private readonly DEFAULT_TEXT = "Tanvas AI";
  private readonly DEFAULT_TIMEOUT = 180_000; // 增加超时时间，因为图片水印处理更复杂

  constructor(private readonly oss: OssService) {}

  /**
   * 为视频添加图片水印（样式与图片水印一致：右下角半透明 logo），并上传至 OSS
   * 使用临时文件处理，因为 MP4 格式不支持管道输出
   */
  async addWatermarkAndUpload(
    sourceUrl: string,
    options?: VideoWatermarkOptions
  ): Promise<{ url: string; key: string; durationMs: number }> {
    const started = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.DEFAULT_TIMEOUT;
    const key =
      options?.ossKey ||
      `videos/watermarked/${this.buildDatePrefix()}/video-${this.safeRandomId()}.mp4`;

    // 检查水印图片是否存在
    if (!fs.existsSync(WATERMARK_IMAGE_PATH)) {
      this.logger.warn(
        `水印图片不存在: ${WATERMARK_IMAGE_PATH}，回退到文字水印`
      );
      return this.addTextWatermarkAndUpload(sourceUrl, options);
    }

    // 创建临时文件路径
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `watermark-${this.safeRandomId()}.mp4`);

    // 构造 filter_complex 滤镜：
    // 使用 scale2ref 根据主视频尺寸缩放水印图片（与图片水印逻辑一致）
    // 水印宽度 = min(主视频宽,高) * WATERMARK_SCALE
    const filterComplex = [
      // 缩放水印：宽度 = min(主视频宽,高) * WATERMARK_SCALE，保持宽高比
      `[1:v][0:v]scale2ref=w='min(main_w,main_h)*${WATERMARK_SCALE}':h='ow/mdar':flags=lanczos[wm][base]`,
      // 设置水印透明度
      `[wm]format=rgba,colorchannelmixer=aa=${WATERMARK_OPACITY}[wm_alpha]`,
      // 叠加到右下角，留边距
      `[base][wm_alpha]overlay=main_w-overlay_w-${WATERMARK_MARGIN}:main_h-overlay_h-${WATERMARK_MARGIN}`,
    ].join(";");

    const ffArgs = [
      "-y",
      "-i",
      sourceUrl, // 输入视频
      "-i",
      WATERMARK_IMAGE_PATH, // 输入水印图片
      "-filter_complex",
      filterComplex,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      tempFile, // 输出到临时文件
    ];

    this.logger.log(`🎥 Start video watermarking -> temp: ${tempFile}`);

    try {
      // 执行 ffmpeg 命令
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", ffArgs, {
          stdio: ["ignore", "pipe", "pipe"],
        });

        const stderrChunks: Buffer[] = [];
        ffmpeg.stderr?.on("data", (chunk) => {
          if (stderrChunks.length < 30) stderrChunks.push(Buffer.from(chunk));
        });

        const timeout = setTimeout(() => {
          ffmpeg.kill("SIGKILL");
          reject(new ServiceUnavailableException("ffmpeg timeout"));
        }, timeoutMs);

        ffmpeg.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        ffmpeg.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve();
          } else {
            const stderr = Buffer.concat(stderrChunks).toString("utf8");
            reject(
              new ServiceUnavailableException(
                `ffmpeg exited with code ${code}${
                  stderr ? `: ${stderr.slice(-500)}` : ""
                }`
              )
            );
          }
        });
      });

      // 检查临时文件是否存在
      if (!fs.existsSync(tempFile)) {
        throw new ServiceUnavailableException("ffmpeg 未生成输出文件");
      }

      // 上传到 OSS
      this.logger.log(`🎥 Uploading watermarked video to OSS: ${key}`);
      const fileStream = fs.createReadStream(tempFile);
      const uploadOptions: OSS.PutStreamOptions = {
        mime: "video/mp4",
        timeout: 120000,
        meta: { uid: 0, pid: 0 },
        callback: undefined as unknown as OSS.ObjectCallback,
      };
      const { url } = await this.oss.putStream(key, fileStream, uploadOptions);

      const elapsed = Date.now() - started;
      this.logger.log(
        `✅ Video watermarked and uploaded: ${key} (${elapsed}ms)`
      );
      return { url, key, durationMs: elapsed };
    } finally {
      // 清理临时文件
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {
        this.logger.warn(`清理临时文件失败: ${tempFile}`);
      }
    }
  }

  /**
   * 将原始视频无水印上传到 OSS（仅做转存，确保可跨域访问）
   */
  async uploadOriginalToOSS(
    sourceUrl: string,
    options?: VideoWatermarkOptions
  ): Promise<{ url: string; key: string; durationMs: number }> {
    const started = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.DEFAULT_TIMEOUT;
    const key =
      options?.ossKey ||
      `videos/raw/${this.buildDatePrefix()}/video-${this.safeRandomId()}.mp4`;

    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `raw-${this.safeRandomId()}.mp4`);

    // 纯复制流（不加水印），保持原视频编码，开启 faststart 方便前端加载
    const ffArgs = [
      "-y",
      "-i",
      sourceUrl,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      tempFile,
    ];

    this.logger.log(`🎥 Start passthrough upload -> temp: ${tempFile}`);

    try {
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", ffArgs, {
          stdio: ["ignore", "ignore", "pipe"],
        });

        const stderrChunks: Buffer[] = [];
        ffmpeg.stderr?.on("data", (chunk) => {
          if (stderrChunks.length < 10) stderrChunks.push(Buffer.from(chunk));
        });

        const timer = setTimeout(() => {
          ffmpeg.kill("SIGKILL");
          reject(new ServiceUnavailableException("ffmpeg timeout"));
        }, timeoutMs);

        ffmpeg.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        ffmpeg.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            const stderr = Buffer.concat(stderrChunks).toString("utf8");
            reject(
              new ServiceUnavailableException(
                `ffmpeg exited with code ${code}${
                  stderr ? `: ${stderr.slice(-400)}` : ""
                }`
              )
            );
          }
        });
      });

      if (!fs.existsSync(tempFile)) {
        throw new ServiceUnavailableException("ffmpeg 未生成输出文件");
      }

      this.logger.log(`🎥 Uploading raw video to OSS: ${key}`);
      const { url } = await this.oss.putStream(
        key,
        fs.createReadStream(tempFile),
        {
          mime: "video/mp4",
          timeout: 120000,
          meta: { uid: 0, pid: 0 },
          callback: undefined as unknown as OSS.ObjectCallback,
        }
      );

      const elapsed = Date.now() - started;
      this.logger.log(
        `✅ Video uploaded without watermark: ${key} (${elapsed}ms)`
      );
      return { url, key, durationMs: elapsed };
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {
        this.logger.warn(`清理临时文件失败: ${tempFile}`);
      }
    }
  }

  /**
   * 回退方案：使用文字水印（当图片水印不可用时）
   */
  private async addTextWatermarkAndUpload(
    sourceUrl: string,
    options?: VideoWatermarkOptions
  ): Promise<{ url: string; key: string; durationMs: number }> {
    const started = Date.now();
    const text = (options?.text || this.DEFAULT_TEXT).replace(/'/g, "\\'");
    const timeoutMs = options?.timeoutMs ?? this.DEFAULT_TIMEOUT;
    const key =
      options?.ossKey ||
      `videos/watermarked/${this.buildDatePrefix()}/video-${this.safeRandomId()}.mp4`;

    // 构造 drawtext 滤镜，字号按视频高度动态 3.5%，右下角内缩 20px
    const drawtext = `drawtext=text='${text}':fontcolor=white@0.75:fontsize=h*0.035:x=w-tw-20:y=h-th-20:font=sans-serif`;

    const ffArgs = [
      "-y",
      "-i",
      sourceUrl,
      "-vf",
      drawtext,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "pipe:1",
    ];

    this.logger.log(
      `🎥 Start video text watermarking (fallback) -> OSS: ${key}`
    );

    const ffmpeg = spawn("ffmpeg", ffArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderrChunks: Buffer[] = [];
    ffmpeg.stderr?.on("data", (chunk) => {
      if (stderrChunks.length < 20) stderrChunks.push(Buffer.from(chunk));
    });

    let timeout: NodeJS.Timeout | null = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
    }, timeoutMs);

    const uploadOptions: OSS.PutStreamOptions = {
      mime: "video/mp4",
      timeout: 120000,
      meta: { uid: 0, pid: 0 },
      callback: undefined as unknown as OSS.ObjectCallback,
    };
    const uploadPromise = this.oss.putStream(key, ffmpeg.stdout, uploadOptions);

    const exitPromise = new Promise<void>((resolve, reject) => {
      ffmpeg.on("error", (err) => reject(err));
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          const stderr = Buffer.concat(stderrChunks).toString("utf8");
          reject(
            new ServiceUnavailableException(
              `ffmpeg exited with code ${code}${stderr ? `: ${stderr}` : ""}`
            )
          );
        }
      });
    });

    try {
      await Promise.all([uploadPromise, exitPromise]);
      const elapsed = Date.now() - started;
      if (timeout) clearTimeout(timeout);
      const { url } = await uploadPromise;
      this.logger.log(
        `✅ Video text watermarked and uploaded: ${key} (${elapsed}ms)`
      );
      return { url, key, durationMs: elapsed };
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      this.logger.warn(`❌ Video text watermark failed for ${key}: ${error}`);
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      ffmpeg.stdout?.removeAllListeners();
      ffmpeg.stderr?.removeAllListeners();
    }
  }

  private buildDatePrefix(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    return `${yyyy}/${mm}/${dd}`;
  }

  private safeRandomId(): string {
    return (randomUUID?.() || Math.random().toString(16).slice(2, 10)).replace(
      /-/g,
      ""
    );
  }
}
