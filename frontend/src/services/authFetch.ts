import { useAuthStore } from '@/stores/authStore';
import { tokenRefreshManager } from './tokenRefreshManager';

type RequestInput = RequestInfo | URL;

let refreshPromise: Promise<boolean> | null = null;

async function ensureRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => {
        if (res.ok) {
          // 刷新成功，通知 tokenRefreshManager
          tokenRefreshManager.onLoginSuccess();
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

const normalizeInit = (init?: RequestInit): RequestInit => ({
  ...(init || {}),
  credentials: 'include',
});

/**
 * 处理未授权情况
 * 优雅降级：触发登录弹窗事件，而非强制跳转
 */
function handleUnauthorized() {
  // 触发登录弹窗事件（优雅降级）
  try {
    window.dispatchEvent(new CustomEvent('auth-expired'));
  } catch {}

  // 清空用户状态，但不跳转页面
  try {
    const store = useAuthStore.getState();
    // 设置错误信息，但保留页面状态
    useAuthStore.setState({
      user: null,
      loading: false,
      connection: null,
      error: '登录已过期，请重新登录',
    });
  } catch (error) {
    console.warn('authFetch: failed to update auth state', error);
  }
}

export async function fetchWithAuth(input: RequestInput, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, normalizeInit(init));
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  const refreshed = await ensureRefresh();
  if (refreshed) {
    return fetch(input, normalizeInit(init));
  }

  handleUnauthorized();
  return response;
}
