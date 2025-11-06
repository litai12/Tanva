import { useAuthStore } from '@/stores/authStore';

type RequestInput = RequestInfo | URL;

let refreshPromise: Promise<boolean> | null = null;

async function ensureRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
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

function handleUnauthorized() {
  try {
    const store = useAuthStore.getState();
    if (typeof store.forceLogout === 'function') {
      store.forceLogout();
    } else {
      // fallback: 清空用户态，避免继续发起受保护请求
      useAuthStore.setState({ user: null, loading: false, connection: null });
    }
  } catch (error) {
    console.warn('authFetch: failed to force logout after 401', error);
  }
  try {
    window.dispatchEvent(new CustomEvent('auth-expired'));
  } catch {}
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
