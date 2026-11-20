import { domainToASCII } from 'node:url';

/**
 * 规范化 Host：小写、去端口、去尾点、punycode。
 * x-forwarded-host 可能逗号分隔，取第一个。无效返回 null。
 */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let h = String(raw).trim().toLowerCase();
  if (!h) return null;
  h = h.split(',')[0].trim(); // 多级反代逗号分隔，取第一个
  h = h.replace(/\.+$/, ''); // 去尾点（须在去端口前，端口可能带尾点 :8080.）
  h = h.replace(/:\d+$/, ''); // 去端口
  if (!h) return null;
  const ascii = domainToASCII(h); // 国际化域名 punycode
  return ascii || h;
}
