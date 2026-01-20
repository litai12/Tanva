import { tokenRefreshManager } from './tokenRefreshManager';
import { triggerAuthExpired } from './authEvents';
import { getAccessToken, getRefreshAuthHeader, setTokens } from './authTokenStorage';

type RequestInput = RequestInfo | URL;

let refreshPromise: Promise<boolean> | null = null;

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

const normalizeInit = (init?: RequestInit): RequestInit => {
  const headers = new Headers(init?.headers || {});
  if (!headers.has('Authorization')) {
    const accessToken = getAccessToken();
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
  }
  return {
    ...(init || {}),
    credentials: 'include',
    headers,
  };
};

export async function fetchWithAuth(input: RequestInput, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, normalizeInit(init));
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  const refreshed = await ensureRefresh();
  if (refreshed) {
    const retryResponse = await fetch(input, normalizeInit(init));
    // refresh 返回 ok 但重试仍 401/403：认为登录态已失效，触发退出/登录提示
    if (retryResponse.status === 401 || retryResponse.status === 403) {
      triggerAuthExpired();
    }
    return retryResponse;
  }

  triggerAuthExpired();
  return response;
}
