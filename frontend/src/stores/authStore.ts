import { create } from 'zustand';
import { authApi, type UserInfo } from '@/services/authApi';

type AuthState = {
  user: UserInfo | null;
  loading: boolean;
  error: string | null;
  connection: 'mock' | 'server' | 'refresh' | 'local' | null;
  init: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  loginWithSms: (phone: string, code: string) => Promise<void>;
  register: (phone: string, password: string, name?: string, email?: string, invitationCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  forceLogout: (reason?: string) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // 初始为 false，采用延迟初始化（只有进入受保护路由或登录时才触发）
  loading: false,
  error: null,
  connection: null,
  init: async () => {
    set({ loading: true, error: null });
    try {
      // 详细来源：server / refresh / local / mock
      const { user, source } = await (authApi as any).meDetailed?.() ?? { user: await authApi.me(), source: null };
      set({ user, loading: false, connection: (source as any) || null });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '加载失败' });
    }
  },
  loginWithSms: async (phone, code) => {
    set({ loading: true, error: null });
    try {
      const { user } = await authApi.loginWithSms({ phone, code });
      set({ user, loading: false, connection: 'server' });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '登录失败' });
      throw e;
    }
  },
  login: async (phone, password) => {
    set({ loading: true, error: null });
    try {
      const { user } = await authApi.login({ phone, password });
      set({ user, loading: false, connection: 'server' });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '登录失败' });
      throw e;
    }
  },
  register: async (phone, password, name, email, invitationCode) => {
    set({ loading: true, error: null });
    try {
      await authApi.register({ phone, password, name, email, invitationCode });
      set({ loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '注册失败' });
      throw e;
    }
  },
  logout: async () => {
    set({ loading: true, error: null });
    try {
      await authApi.logout();
      set({ user: null, loading: false, connection: null });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '登出失败' });
    }
  },
  forceLogout: (reason) => {
    set({
      user: null,
      loading: false,
      connection: null,
      error: reason || '登录状态已失效，请重新登录',
    });
    try { localStorage.removeItem('mock_user'); } catch {}
  }
}));
