// 详情页长图：把各屏图片统一宽度后自上而下拼成一张 JPEG。
import sharp from 'sharp';

/** 拼接宽度上限（电商详情页常用 750–1242）。 */
export const STITCH_MAX_WIDTH = 1242;
/** JPEG 单边上限 65535；留余量。 */
export const STITCH_MAX_HEIGHT = 60_000;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export async function stitchVertical(images: Buffer[]): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (!images.length) throw new Error('没有可拼接的图片');
  const metas = await Promise.all(images.map(img => sharp(img).metadata()));
  const width = Math.min(STITCH_MAX_WIDTH, ...metas.map(m => m.width || STITCH_MAX_WIDTH));
  const parts = await Promise.all(images.map(img => sharp(img).rotate().resize({ width }).flatten({ background: '#ffffff' }).toBuffer({ resolveWithObject: true })));
  const height = parts.reduce((sum, p) => sum + p.info.height, 0);
  if (height > STITCH_MAX_HEIGHT) throw new Error('长图过高，请减少屏数');
  let top = 0;
  const composite = parts.map(p => { const item = { input: p.data, top, left: 0 }; top += p.info.height; return item; });
  const buffer = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite(composite).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { buffer, width, height };
}

/** 只下载我们自己生成的 https 图片，限大小与超时。 */
export async function fetchImage(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('图片地址无效');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(parsed, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载图片失败（HTTP ${res.status}）`);
    const length = Number(res.headers.get('content-length') || 0);
    if (length > MAX_SOURCE_BYTES) throw new Error('图片过大');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error('图片过大');
    return buffer;
  } finally { clearTimeout(timer); }
}
