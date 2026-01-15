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
 * - 禁止 data: / blob: / 内联 base64（尤其是图片数据）进入持久化存储
 * - 递归移除命中字段（对象属性被删；数组元素被置为 null 以保持索引稳定）
 */
export function sanitizeDesignJson<T = unknown>(input: T): T {
  const seen = new WeakMap<object, any>();

  const walk = (value: any, inArray: boolean): any => {
    if (value === null || value === undefined) return value;

    const valueType = typeof value;

    if (valueType === 'string') {
      return looksLikeEmbeddedImageString(value) ? undefined : value;
    }

    if (valueType === 'number' || valueType === 'boolean') {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => {
        const next = walk(item, true);
        return next === undefined ? null : next;
      });
    }

    if (valueType === 'object') {
      const cached = seen.get(value as object);
      if (cached) return cached;

      const result: Record<string, any> = {};
      seen.set(value as object, result);

      for (const [key, child] of Object.entries(value)) {
        const next = walk(child, false);
        if (next === undefined) continue;
        result[key] = next;
      }
      return result;
    }

    // function / symbol 等：丢弃
    return inArray ? null : undefined;
  };

  return walk(input, false);
}

