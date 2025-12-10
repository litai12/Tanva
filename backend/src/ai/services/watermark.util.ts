import sharp from "sharp";

/**
 * 将 base64（或 data URL）图片添加文字水印，返回新的 data URL（png）。
 * @param base64 原始图片（支持 data URL）
 * @param options.text 水印文字
 */
export async function applyWatermarkToBase64(
  base64: string,
  options?: { text?: string }
): Promise<string> {
  const text = options?.text?.trim() || "Tanvas AI";

  const dataPart = base64.startsWith("data:") ? base64.split(",")[1] : base64;

  const buffer = Buffer.from(dataPart, "base64");
  const image = sharp(buffer);
  const { width = 0, height = 0 } = await image.metadata();

  // 如果拿不到尺寸，直接返回原图
  if (!width || !height) {
    return base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${dataPart}`;
  }

  // 生成简单的文字水印（右下角，半透明白色）
  const watermarkSvg = `
    <svg width="${width}" height="${height}">
      <text
        x="${width - 25}"
        y="${height - 25}"
        text-anchor="end"
        fill="rgba(255, 255, 255, 0.75)"
        font-size="${Math.max(40, Math.round(Math.min(width, height) * 0.03))}"
        font-family="sans-serif"
      >
        ${text}
      </text>
    </svg>
  `;

  const output = await image
    .composite([{ input: Buffer.from(watermarkSvg), gravity: "southeast" }])
    .png()
    .toBuffer();

  return `data:image/png;base64,${output.toString("base64")}`;
}









