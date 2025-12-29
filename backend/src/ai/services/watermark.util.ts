import sharp from "sharp";
import * as path from "path";
import * as fs from "fs";

// 可配置项：允许通过环境变量覆盖水印路径；并尝试多个候选路径以增强鲁棒性
const DEFAULT_WATERMARK_FILENAME = "tanvas_ai.png";
const WATERMARK_OPACITY = 0.8;
const WATERMARK_SCALE = 0.25;
const WATERMARK_MARGIN = 25;

function resolveWatermarkImagePath(): string | null {
  const candidates = [
    process.env.WATERMARK_PATH,
    path.resolve(process.cwd(), "frontend/public", DEFAULT_WATERMARK_FILENAME),
    path.resolve(
      __dirname,
      "../../../../frontend/public",
      DEFAULT_WATERMARK_FILENAME
    ),
    path.resolve(__dirname, "../../public", DEFAULT_WATERMARK_FILENAME),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

/**
 * 将 base64（或 data URL）图片添加图片水印，返回纯 base64 字符串。
 * @param base64 原始图片（支持 data URL）
 */
export async function applyWatermarkToBase64(
  base64: string,
  options?: { text?: string }
): Promise<string> {
  const dataPart = base64.startsWith("data:") ? base64.split(",")[1] : base64;

  const buffer = Buffer.from(dataPart, "base64");
  const image = sharp(buffer);
  const { width = 0, height = 0 } = await image.metadata();

  // 如果拿不到尺寸，直接返回原图（纯 base64）
  if (!width || !height) {
    return dataPart;
  }

  // 读取水印图片（尝试多路径）
  const watermarkPath = resolveWatermarkImagePath();
  if (!watermarkPath) {
    console.warn("无法定位水印图片（候选路径均不存在），返回原图");
    return dataPart;
  }

  let watermarkBuffer: Buffer;
  try {
    watermarkBuffer = fs.readFileSync(watermarkPath);
  } catch (error) {
    console.warn("无法读取水印图片，返回原图:", error);
    return dataPart;
  }

  // 获取水印图片尺寸
  const watermarkMeta = await sharp(watermarkBuffer).metadata();
  const wmWidth = watermarkMeta.width || 100;
  const wmHeight = watermarkMeta.height || 100;

  // 根据原图大小计算水印尺寸（水印宽度为图片短边的 WATERMARK_SCALE）
  const shortSide = Math.min(width, height);
  const targetWmWidth = Math.round(shortSide * WATERMARK_SCALE);
  const targetWmHeight = Math.round((targetWmWidth / wmWidth) * wmHeight);

  // 处理水印图片：调整大小并设置透明度
  const processedWatermark = await sharp(watermarkBuffer)
    .resize(targetWmWidth, targetWmHeight, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 调整透明度
  const { data, info } = processedWatermark;
  for (let i = 3; i < data.length; i += 4) {
    // 每4个字节的第4个是alpha通道
    data[i] = Math.round(data[i] * WATERMARK_OPACITY);
  }

  // 将调整透明度后的数据转回 PNG buffer
  const watermarkWithOpacity = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  // 计算水印位置（右下角，留边距）
  const left = width - info.width - WATERMARK_MARGIN;
  const top = height - info.height - WATERMARK_MARGIN;

  // 合成水印
  const output = await image
    .composite([
      {
        input: watermarkWithOpacity,
        left: Math.max(0, left),
        top: Math.max(0, top),
      },
    ])
    .png()
    .toBuffer();

  // 返回纯 base64 字符串（不带 data URL 前缀）
  return output.toString("base64");
}

