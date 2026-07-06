import { tokenRefreshManager } from './tokenRefreshManager';
import { triggerAuthExpired } from './authEvents';
import { getAccessToken, getRefreshAuthHeader, setTokens } from './authTokenStorage';
import { ensureTraceHeader } from '../utils/trace';
import { useTeamStore } from '../stores/teamStore';

type RequestInput = RequestInfo | URL;

export type AuthFetchInit = RequestInit & {
  auth?: "auto" | "omit";
  allowRefresh?: boolean;
  /**
   * 单个请求最长存活时间（毫秒），超时后中止以释放连接。
   * 默认 3 分钟。传 0 或负数可禁用（用于同步视频生成等长耗时接口）。
   * 图像生成/编辑等长耗时接口应显式传 IMAGE_REQUEST_TIMEOUT_MS（15 分钟）。
   */
  timeoutMs?: number;
};

// 默认 3 分钟：避免请求长时间占用 HTTP/1.1 连接槽（单 origin 仅 6 个并发）。
const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

// 图像生成/编辑专用：与后端图像任务上限（IMAGE_TASK_MAX_DURATION_MS）及前端轮询超时
// （imageTaskPoller DEFAULT_TIMEOUT_MS）对齐，避免长耗时图像请求在客户端被过早中止
// （旧的 3 分钟会把同步图像任务掐断，造成「扣费却拿不到图」）。
export const IMAGE_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

let refreshPromise: Promise<boolean> | null = null;
let creditsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const CREDITS_REFRESH_EVENT = "refresh-credits";
const CREDITS_REFRESH_DEBOUNCE_MS = 1500;
const SAFE_URL_BASE = "http://localhost";
const CREDITS_AFFECTING_PATH_PATTERNS = [
  "/api/ai/",
  "/video-gif/convert",
];

const isCreditsAffectingPath = (path: string): boolean =>
  CREDITS_AFFECTING_PATH_PATTERNS.some((pattern) => path.includes(pattern));

const resolveRequestUrl = (input: RequestInput): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return String(input);
};

const resolveRequestMethod = (
  input: RequestInput,
  normalized: RequestInit
): string => {
  if (normalized.method) return String(normalized.method).toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
};

const shouldNotifyCreditsRefresh = (
  input: RequestInput,
  normalized: RequestInit,
  response: Response
): boolean => {
  if (!response.ok) return false;

  const method = resolveRequestMethod(input, normalized);
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }

  const rawUrl = resolveRequestUrl(input);
  try {
    const parsed = new URL(
      rawUrl,
      typeof window !== "undefined" ? window.location.origin : SAFE_URL_BASE
    );
    return isCreditsAffectingPath(parsed.pathname);
  } catch {
    return isCreditsAffectingPath(rawUrl);
  }
};

const notifyCreditsRefreshIfNeeded = (
  input: RequestInput,
  normalized: RequestInit,
  response: Response
) => {
  if (typeof window === "undefined") return;
  if (!shouldNotifyCreditsRefresh(input, normalized, response)) return;
  if (creditsRefreshTimer) {
    clearTimeout(creditsRefreshTimer);
  }
  creditsRefreshTimer = setTimeout(() => {
    creditsRefreshTimer = null;
    window.dispatchEvent(new CustomEvent(CREDITS_REFRESH_EVENT));
  }, CREDITS_REFRESH_DEBOUNCE_MS);
};

const refreshUrl =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")}/api/auth/refresh`
    : "/api/auth/refresh";

async function ensureRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(refreshUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { ...getRefreshAuthHeader() },
    })
      .then((res) => {
        if (res.ok) {
          return res
            .json()
            .catch(() => null)
            .then((data) => {
              if (data?.tokens) {
                setTokens(data.tokens);
              }
              // 刷新成功，通知 tokenRefreshManager
              tokenRefreshManager.onLoginSuccess();
              return true;
            });
        }
        return res.ok;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// 把调用方自带的 signal 与超时 signal 合成：任一触发即中止，请求结束后清理定时器。
const createTimeoutSignal = (
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; cleanup: () => void } => {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: callerSignal ?? undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(`Request timeout after ${timeoutMs}ms`, "TimeoutError"),
    );
  }, timeoutMs);

  const onCallerAbort = () => {
    clearTimeout(timer);
    controller.abort((callerSignal as AbortSignal | undefined)?.reason);
  };

  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  };

  return { signal: controller.signal, cleanup };
};

const normalizeInit = (init?: AuthFetchInit): RequestInit => {
  const { auth, ...rest } = init || {};
  const headers = new Headers(rest.headers || {});
  const authMode = auth ?? "auto";
  ensureTraceHeader(headers);

  if (authMode !== "omit") {
    const accessToken = getAccessToken();
    const currentAuth = headers.get("Authorization");
    if (!currentAuth && accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  // 注入团队上下文
  const teamId = useTeamStore.getState().activeTeamId;
  if (teamId) {
    headers.set('X-Team-Id', teamId);
  }

  const credentials =
    rest.credentials ?? (authMode === "omit" ? "omit" : "include");

  return {
    ...rest,
    credentials,
    headers,
  };
};

export async function fetchWithAuth(
  input: RequestInput,
  init?: AuthFetchInit
): Promise<Response> {
  const {
    allowRefresh = true,
    auth = "auto",
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    ...rest
  } = init || {};
  const rawUrl = resolveRequestUrl(input).trim().toLowerCase();
  if (rawUrl.startsWith("blob:")) {
    return new Response(null, { status: 410, statusText: "blob-url-skipped" });
  }
  if (rawUrl.startsWith("data:")) {
    const directInit: RequestInit = {
      ...rest,
      credentials: "omit",
    };
    return fetch(input, directInit);
  }
  const normalized = normalizeInit({ ...rest, auth });
  const { signal: timedSignal, cleanup } = createTimeoutSignal(
    normalized.signal,
    timeoutMs,
  );
  let response: Response;
  try {
    response = await fetch(input, { ...normalized, signal: timedSignal });
  } finally {
    cleanup();
  }
  if (response.status === 403) {
    notifyCreditsRefreshIfNeeded(input, normalized, response);
    return response;
  }

  if (response.status !== 401) {
    notifyCreditsRefreshIfNeeded(input, normalized, response);
    return response;
  }

  if (auth === "omit") {
    return response;
  }

  if (!allowRefresh) {
    triggerAuthExpired();
    return response;
  }

  const refreshed = await ensureRefresh();
  if (refreshed) {
    const retryNormalized = normalizeInit({ ...rest, auth });
    const { signal: retrySignal, cleanup: retryCleanup } = createTimeoutSignal(
      retryNormalized.signal,
      timeoutMs,
    );
    let retryResponse: Response;
    try {
      retryResponse = await fetch(input, {
        ...retryNormalized,
        signal: retrySignal,
      });
    } finally {
      retryCleanup();
    }
    // refresh 返回 ok 但重试仍 401：认为登录态已失效，触发退出/登录提示。
    // 403 是业务权限拒绝（例如会员权益不足），不能当作登录过期处理。
    if (retryResponse.status === 401) {
      triggerAuthExpired();
    }
    notifyCreditsRefreshIfNeeded(input, retryNormalized, retryResponse);
    return retryResponse;
  }

  triggerAuthExpired();
  return response;
}
