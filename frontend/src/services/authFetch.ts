import { tokenRefreshManager } from './tokenRefreshManager';
import { triggerAuthExpired } from './authEvents';
import { getAccessToken, getRefreshAuthHeader, setTokens } from './authTokenStorage';
import { ensureTraceHeader } from '../utils/trace';

type RequestInput = RequestInfo | URL;

export type AuthFetchInit = RequestInit & {
  auth?: "auto" | "omit";
  allowRefresh?: boolean;
};

let refreshPromise: Promise<boolean> | null = null;

const CREDITS_REFRESH_EVENT = "refresh-credits";
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
  window.dispatchEvent(new CustomEvent(CREDITS_REFRESH_EVENT));
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
  const { allowRefresh = true, auth = "auto", ...rest } = init || {};
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
  const response = await fetch(input, normalized);
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
    const retryResponse = await fetch(input, retryNormalized);
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
