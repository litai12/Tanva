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

function sanitizeString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return value;
  return looksLikeEmbeddedImageString(trimmed) ? undefined : value;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      const sanitizedChild = sanitizeValue(child);
      if (sanitizedChild === undefined) return;
      next[key] = sanitizedChild;
    });
    return next;
  }

  return value;
}

/**
 * 设计 JSON（Project.contentJson / PublicTemplate.templateData）清洗：
 * - 禁止 data: / blob: / 内联 base64 进入持久化存储
 * - 仅保留可长期访问的 URL / 路径 / 普通文本字段
 */
export function sanitizeDesignJson<T = unknown>(input: T): T {
  return sanitizeValue(input) as T;
}
