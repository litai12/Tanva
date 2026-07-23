const ASSET_ID_PATTERN = /\basset-[a-z0-9-]+\b/i;

function collectErrorText(value: unknown, depth = 0, seen = new Set<unknown>()): string[] {
  if (depth > 5 || value === null || value === undefined || seen.has(value)) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return [trimmed, ...collectErrorText(JSON.parse(trimmed), depth + 1, seen)];
    } catch {
      return [trimmed];
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object') return [];

  seen.add(value);
  const record = value as Record<string, unknown>;
  const texts: string[] = [];
  for (const key of ['message', 'code', 'param', 'type', 'upstreamCode', 'upstreamMessage']) {
    texts.push(...collectErrorText(record[key], depth + 1, seen));
  }
  for (const key of ['error', 'response', 'cause', 'data', 'body']) {
    texts.push(...collectErrorText(record[key], depth + 1, seen));
  }
  const getResponse = record.getResponse;
  if (typeof getResponse === 'function') {
    try {
      texts.push(...collectErrorText(getResponse.call(value), depth + 1, seen));
    } catch {
      // Some framework wrappers expose an unsafe response accessor.
    }
  }
  return texts;
}

export function isMissingVolcAssetError(error: unknown): boolean {
  const text = collectErrorText(error).join(' ').toLowerCase();
  if (!text || !text.includes('not found')) return false;
  return (
    ASSET_ID_PATTERN.test(text) ||
    text.includes('specified asset') ||
    text.includes('asset://') ||
    (text.includes('image_url') && text.includes('asset'))
  );
}
