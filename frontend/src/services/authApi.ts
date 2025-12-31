export type UserInfo = {
  id: string;
  email: string;
  name?: string;
  role?: string;
  phone?: string;
};

export type GoogleApiKeyInfo = {
  hasCustomKey: boolean;
  maskedKey: string | null;
  mode: "official" | "custom";
};

const viteEnv =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : undefined;
const isMock = viteEnv?.VITE_AUTH_MODE === "mock";

// 后端基础地址，统一从 .env 中读取：
// 例如在 .env.development / .env.production 中配置：
// VITE_API_BASE_URL="https://your-backend-domain.com"
// 如果不配置，则默认 http://localhost:4000
const base =
  viteEnv?.VITE_API_BASE_URL && viteEnv.VITE_API_BASE_URL.trim().length > 0
    ? viteEnv.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

// Simple localStorage-based mock helpers
const LS_USER_KEY = "mock_user";
const LS_USERS_KEY = "mock_users";
const FIXED_SMS_CODE = "336699";

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

      // 全局处理特定的错误信息
      if (typeof window !== "undefined") {
        // 处理短信发送频率限制
        if (msg.includes("请等待 60 秒后再试")) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "发送过于频繁，请等待60秒后再试",
                type: "error",
              },
            })
          );
        }
        // 处理阿里云业务流控错误
        else if (
          msg.includes("isv.BUSINESS_LIMIT_CONTROL") ||
          msg.includes("触发天级流控")
        ) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "发送过于频繁，请稍后再试",
                type: "error",
              },
            })
          );
        }
      }
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const authApi = {
  async meDetailed(): Promise<{
    user: UserInfo | null;
    source: "mock" | "server" | "refresh" | "local" | null;
  }> {
    if (isMock) {
      await delay(200);
      return { user: loadSession(), source: "mock" };
    }
    try {
      let res = await fetch(`${base}/api/auth/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const user =
          data && typeof data === "object" && "user" in data
            ? (data.user as UserInfo)
            : (data as UserInfo);
        return { user, source: "server" };
      }
      if (res.status === 401 || res.status === 403) {
        try {
          const r = await fetch(`${base}/api/auth/refresh`, {
            method: "POST",
            credentials: "include",
          });
          if (r.ok) {
            res = await fetch(`${base}/api/auth/me`, {
              credentials: "include",
            });
            if (res.ok) {
              const data = await res.json().catch(() => null);
              const user =
                data && typeof data === "object" && "user" in data
                  ? (data.user as UserInfo)
                  : (data as UserInfo);
              return { user, source: "refresh" };
            }
          }
        } catch (e) {
          console.warn("authApi.refresh failed:", e);
        }
      }
      console.warn("authApi.me not ok:", res.status);
      return { user: loadSession(), source: "local" };
    } catch (e) {
      console.warn("authApi.me network error:", e);
      return { user: loadSession(), source: "local" };
    }
  },
  async register(payload: {
    phone: string;
    password: string;
    name?: string;
    email?: string;
    invitationCode?: string;
  }) {
    if (isMock) {
      await delay(300);
      const users = readUsers();
      const exists = users.find((u) => u.phone === payload.phone);
      if (exists) throw new Error("用户已存在");
      const user: UserInfo = {
        id: `u_${Date.now()}`,
        email: payload.email || `${payload.phone}@mock.local`,
        phone: payload.phone,
        name: payload.name || `用户${payload.phone.slice(-4)}`,
        role: "user",
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    return json<{ user: UserInfo }>(res);
  },
  async login(payload: { phone: string; password: string }) {
    if (isMock) {
      await delay(300);
      const users = readUsers();
      const user = users.find((u) => u.phone === payload.phone);
      if (!user) {
        throw new Error("用户不存在，请先注册");
      }
      saveSession(user);
      return { user };
    }
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const out = await json<{ user: UserInfo }>(res);
    // 本地持久化用户，提升刷新体验（用于开发环境或后端短暂不可用时）
    saveSession(out.user);
    return out;
  },
  async loginWithSms(payload: { phone: string; code: string }) {
    if (isMock) {
      await delay(300);
      if (!payload.phone) throw new Error("请输入手机号");
      if (payload.code !== FIXED_SMS_CODE)
        throw new Error("验证码错误（使用 336699）");
      const users = readUsers();
      const user = users.find(
        (u) =>
          u.phone === payload.phone || u.email === `${payload.phone}@mock.local`
      );
      if (!user) throw new Error("用户不存在，请先注册");
      saveSession(user);
      return { user };
    }
    const res = await fetch(`${base}/api/auth/login-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const out = await json<{ user: UserInfo }>(res);
    saveSession(out.user);
    return out;
  },
  async sendSms(payload: { phone: string }) {
    if (isMock) {
      await delay(300);
      return { ok: true } as { ok: true };
    }
    const res = await fetch(`${base}/api/auth/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await json<{ ok: boolean; error?: string }>(res);

    // 如果后端返回 ok=false，则将其作为异常抛出，统一由调用方在 catch 中展示全局提示
    if (!result.ok) {
      const err = result.error || "发送失败";
      if (err.includes("请等待")) {
        throw new Error("请等待 60 秒后再试");
      } else if (err.includes("BUSINESS_LIMIT_CONTROL")) {
        throw new Error("今日发送过于频繁，每日只允许发送10条短信，请明日再试");
      }
      throw new Error(err);
    }

    return result;
  },
  async me() {
    if (isMock) {
      await delay(200);
      return loadSession();
    }
    try {
      let res = await fetch(`${base}/api/auth/me`, { credentials: "include" });
      if (!res.ok) {
        // 常见 401：尝试使用 refresh cookie 刷新一次
        if (res.status === 401 || res.status === 403) {
          try {
            const r = await fetch(`${base}/api/auth/refresh`, {
              method: "POST",
              credentials: "include",
            });
            if (r.ok) {
              res = await fetch(`${base}/api/auth/me`, {
                credentials: "include",
              });
            }
          } catch (e) {
            console.warn("authApi.refresh failed:", e);
          }
        }
      }
      if (!res.ok) {
        console.warn("authApi.me not ok:", res.status);
        // 尝试使用本地持久化的用户，避免开发场景下的闪跳登录
        return loadSession();
      }
      const data = await res.json().catch(() => null);
      if (!data) return null;
      return data && typeof data === "object" && "user" in data
        ? (data.user as UserInfo)
        : (data as UserInfo);
    } catch (e) {
      console.warn("authApi.me network error:", e);
      return loadSession();
    }
  },
  async logout() {
    if (isMock) {
      await delay(200);
      clearSession();
      return { ok: true } as { ok: boolean };
    }

    let ok = false;
    try {
      const res = await fetch(`${base}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          msg = data?.message || data?.error || msg;
        } catch {}
        console.warn("authApi.logout failed:", msg);
      } else {
        ok = true;
      }
    } catch (error) {
      console.warn("authApi.logout network error:", error);
    } finally {
      clearSession();
    }

    return { ok } as { ok: boolean };
  },

  // Google API Key 管理相关
  async getGoogleApiKey(): Promise<GoogleApiKeyInfo> {
    if (isMock) {
      await delay(200);
      // Mock 模式下返回空状态
      return { hasCustomKey: false, maskedKey: null, mode: "official" };
    }

    try {
      const res = await fetch(`${base}/api/users/google-api-key`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.warn("authApi.getGoogleApiKey failed:", e);
      return { hasCustomKey: false, maskedKey: null, mode: "official" };
    }
  },

  async updateGoogleApiKey(dto: {
    googleCustomApiKey?: string | null;
    googleKeyMode?: "official" | "custom";
  }): Promise<{ success: boolean; hasCustomKey: boolean; mode: string }> {
    if (isMock) {
      await delay(200);
      return {
        success: true,
        hasCustomKey: !!dto.googleCustomApiKey,
        mode: dto.googleKeyMode || "custom",
      };
    }

    const res = await fetch(`${base}/api/users/google-api-key`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dto),
      credentials: "include",
    });
    return json<{ success: boolean; hasCustomKey: boolean; mode: string }>(res);
  },

  // 忘记密码重置
  async resetPassword(payload: {
    phone: string;
    code: string;
    newPassword: string;
  }) {
    if (isMock) {
      await delay(500);
      // Mock模式下简单验证
      if (payload.code !== FIXED_SMS_CODE) {
        throw new Error("验证码错误");
      }
      return { success: true };
    }
    const res = await fetch(`${base}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<{ success: boolean }>(res);
  },
};
