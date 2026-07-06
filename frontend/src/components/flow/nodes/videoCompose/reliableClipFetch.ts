/**
 * 可靠地拉取视频/音频片段字节流（供 WebAV 合成使用）。
 *
 * 背景：浏览器端合成（composeVideosToBlob / 编辑器加载）用 fetch() 直读字节，
 * 跨域 OSS/CDN 直链常因缺 CORS 头或源站限流间歇失败，一旦某个片段失败整次合成就抛错。
 *
 * 修复策略（双保险）：
 *  1. 优先走同源 /api/assets/proxy —— 后端代理直读 OSS，绕开 CORS / 限流；
 *     非我们托管的三方直链由 proxifyRemoteAssetUrl 原样返回，客户端直连。
 *  2. 指数退避重试，并把「200 但响应体是 HTML」也判为失败（限流/错误页伪装成功）。
 */

import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";

// 这些状态码视为瞬态（限流/网关/源站抖动），可重试。
const TRANSIENT_STATUS = new Set([404, 408, 425, 429, 500, 502, 503, 504]);

export type FetchClipOptions = {
  signal?: AbortSignal;
  /** 每个候选地址的尝试次数（含首次），默认 3 */
  attempts?: number;
  /** 退避基准毫秒，默认 400（400 / 800 / 1600…） */
  baseDelayMs?: number;
  /** 可注入的 sleep（测试用） */
  sleep?: (ms: number) => Promise<void>;
};

function isHtmlResponse(res: Response): boolean {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml");
}

type FetchError = Error & { status?: number; transient?: boolean };

async function attemptOnce(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) {
    const e: FetchError = new Error(`HTTP ${res.status} for ${url}`);
    e.status = res.status;
    e.transient = TRANSIENT_STATUS.has(res.status);
    throw e;
  }
  // 200 但返回 HTML = 限流/错误页伪装成功，丢弃并当瞬态失败重试。
  if (isHtmlResponse(res)) {
    const e: FetchError = new Error(`expected video bytes but got HTML for ${url}`);
    e.transient = true;
    throw e;
  }
  return res;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * 拉取一个片段，返回可用的 Response（res.body 给 MP4Clip / AudioClip 用）。
 * 失败时抛出最后一次错误。
 */
export async function fetchClip(
  clipUrl: string,
  options?: FetchClipOptions
): Promise<Response> {
  const signal = options?.signal;
  const attempts = Math.max(1, options?.attempts ?? 3);
  const baseDelayMs = options?.baseDelayMs ?? 400;
  const sleep = options?.sleep ?? defaultSleep;

  // 同源代理候选：仅当 proxifyRemoteAssetUrl 真的改写了地址（即属我们托管的 OSS/CDN）时启用。
  let proxied: string | null = null;
  try {
    const p = proxifyRemoteAssetUrl(clipUrl, { forceProxy: true });
    if (p && p !== clipUrl) proxied = p;
  } catch {
    proxied = null;
  }

  // 候选顺序：同源代理 → 原始直链
  const candidates: { url: string; isProxy: boolean }[] = proxied
    ? [
        { url: proxied, isProxy: true },
        { url: clipUrl, isProxy: false },
      ]
    : [{ url: clipUrl, isProxy: false }];

  let lastErr: unknown = new Error(`failed to fetch clip: ${clipUrl}`);

  for (const candidate of candidates) {
    for (let a = 0; a < attempts; a++) {
      if (signal?.aborted) throw new Error("合成已取消");
      try {
        return await attemptOnce(candidate.url, signal);
      } catch (err) {
        lastErr = err;
        const fe = err as FetchError;
        // 代理回 4xx（非瞬态）= 此 url 代理不可用 → 立刻回退直连。
        if (
          candidate.isProxy &&
          fe?.status != null &&
          !TRANSIENT_STATUS.has(fe.status)
        ) {
          break;
        }
        // 永久错误（如 403 过期签名）→ 不在本候选上继续重试，换下个候选。
        if (fe?.status != null && !TRANSIENT_STATUS.has(fe.status)) break;
        if (a < attempts - 1) await sleep(baseDelayMs * 2 ** a);
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`failed to fetch clip: ${clipUrl}`);
}
