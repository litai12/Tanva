/**
 * 前端用 "0.5K" 作为 512px 档位的 label/value，但 Gemini 图像模型
 * （gemini-3.1-flash-image 等）的 imageConfig.imageSize 实际枚举是：
 *   "512" / "1K" / "2K" / "4K"
 * 直接把 "0.5K" 透传上去会得到 "Request contains an invalid argument"。
 *
 * 这里在出站前做归一：把 "0.5K"（及其大小写/写法变体）转换成 API 需要的 "512"，
 * 其余合法值规范化为大写 K 形式，未知值原样返回（交给上游判断）。
 */

/** 512px 档位的各种写法 */
const HALF_K_ALIASES = new Set(['0.5K', '0.5', '.5K', '512']);

/**
 * 将前端传入的 imageSize/resolution 归一为 Gemini API 接受的字符串。
 * - undefined / 空字符串 -> undefined（调用方据此决定是否携带该参数）
 * - 0.5K / 0.5 / .5K / 512 -> "512"
 * - 1k / 2k / 4k（忽略大小写）-> "1K" / "2K" / "4K"
 * - 其他无法识别的值 -> 原样 trim 返回
 */
export function normalizeGeminiImageSize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const upper = trimmed.toUpperCase();
  if (HALF_K_ALIASES.has(upper)) return '512';
  if (upper === '1K' || upper === '2K' || upper === '4K') return upper;

  return trimmed;
}
