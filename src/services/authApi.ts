export type UserInfo = {
  id: string;
  email: string;
  name?: string;
  role?: string;
  phone?: string;
};

const base = '';

// Mock mode toggle (front-end only auth flow)
const viteEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : undefined;
const isMock = viteEnv?.VITE_AUTH_MODE === 'mock';

// Simple localStorage-based mock helpers
const LS_USER_KEY = 'mock_user';
const LS_USERS_KEY = 'mock_users';
const FIXED_SMS_CODE = '336699';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readUsers(): UserInfo[] {
  try {
    const raw = localStorage.getItem(LS_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: UserInfo[]) {
  try {
    localStorage.setItem(LS_USERS_KEY, JSON.stringify(users));
  } catch {}
}

function saveSession(user: UserInfo) {
  try {
    localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
  } catch {}
}

function loadSession(): UserInfo | null {
  try {
    const raw = localStorage.getItem(LS_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(LS_USER_KEY);
  } catch {}
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.message || data?.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const authApi = {
  async register(payload: { phone: string; password: string; name?: string; email?: string }) {
    if (isMock) {
      await delay(300);
      const users = readUsers();
      const exists = users.find((u) => u.phone === payload.phone);
      if (exists) throw new Error('用户已存在');
      const user: UserInfo = {
        id: `u_${Date.now()}`,
        email: payload.email || `${payload.phone}@mock.local`,
        phone: payload.phone,
        name: payload.name || `用户${payload.phone.slice(-4)}`,
        role: 'user',
      };
      // persist optional phone for strict SMS login
      if ((payload as any).email) {
        (user as any).email = (payload as any).email;
      }
      users.push(user);
      writeUsers(users);
      return { user };
    }
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    return json<{ user: UserInfo }>(res);
  },
  async login(payload: { phone: string; password: string }) {
    if (isMock) {
      await delay(300);
      const users = readUsers();
      const user = users.find((u) => u.phone === payload.phone);
      if (!user) {
        throw new Error('用户不存在，请先注册');
      }
      saveSession(user);
      return { user };
    }
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    return json<{ user: UserInfo }>(res);
  },
  async loginWithSms(payload: { phone: string; code: string }) {
    if (isMock) {
      await delay(300);
      if (!payload.phone) throw new Error('请输入手机号');
      if (payload.code !== FIXED_SMS_CODE) throw new Error('验证码错误（使用 336699）');
      const users = readUsers();
      const user = users.find((u) => u.phone === payload.phone || u.email === `${payload.phone}@mock.local`);
      if (!user) throw new Error('用户不存在，请先注册');
      saveSession(user);
      return { user };
    }
    const res = await fetch(`${base}/api/auth/login-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    return json<{ user: UserInfo }>(res);
  },
  async sendSms(payload: { phone: string }) {
    if (isMock) {
      await delay(300);
      return { ok: true } as { ok: true };
    }
    const res = await fetch(`${base}/api/auth/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return json<{ ok: boolean }>(res);
  },
  async me() {
    if (isMock) {
      await delay(200);
      return loadSession();
    }
    const res = await fetch(`${base}/api/auth/me`, { credentials: 'include' });
    if (!res.ok) {
      // 常见是 401 未登录：返回 null，由路由处理跳转
      console.warn('authApi.me not ok:', res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data) return null;
    // 兼容 { user: {...} } 与直接返回用户
    return (data && typeof data === 'object' && 'user' in data) ? (data.user as UserInfo) : (data as UserInfo);
  },
  async logout() {
    if (isMock) {
      await delay(200);
      clearSession();
      return { ok: true } as { ok: boolean };
    }
    const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    return json<{ ok: boolean }>(res);
  },
};
