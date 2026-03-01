const DATA_URL_PREFIX = /^data:/i;
const BLOB_URL_PREFIX = /^blob:/i;

const BASE64_IMAGE_MAGIC_PREFIXES = [
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  'iVBORw0KGgo',
  // JPEG: FF D8 FF
  '/9j/',
  // GIF: GIF8
  'R0lGOD',
  // WEBP: RIFF....WEBP
  'UklGR',
  // SVG: <svg
  'PHN2Zy',
] as const;

const looksLikeBase64 = (value: string): boolean => {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 4096) return false;
  if (compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
};

const looksLikeEmbeddedImageString = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (DATA_URL_PREFIX.test(trimmed) || BLOB_URL_PREFIX.test(trimmed)) return true;

  const compact = trimmed.replace(/\s+/g, '');
  if (
    BASE64_IMAGE_MAGIC_PREFIXES.some((prefix) => compact.startsWith(prefix)) &&
    compact.length >= 32
  ) {
    return true;
  }

  return looksLikeBase64(compact);
};

/**
 * 设计 JSON（Project.contentJson / PublicTemplate.templateData）清洗：
 * - 原本用于禁止 data: / blob: / 内联 base64 进入持久化存储
 * - 现已禁用过滤功能，直接返回原始数据，以支持模板中包含内嵌图片
 */
export function sanitizeDesignJson<T = unknown>(input: T): T {
  // 直接返回原始数据，不做任何过滤
  // 如果需要深拷贝，可以使用 JSON.parse(JSON.stringify(input))
  return input;
}

