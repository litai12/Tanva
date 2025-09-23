import { create } from 'zustand';
import { authApi, type UserInfo } from '@/services/authApi';

type AuthState = {
  user: UserInfo | null;
  loading: boolean;
  error: string | null;
  init: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  loginWithSms: (phone: string, code: string) => Promise<void>;
  register: (phone: string, password: string, name?: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // 初始为 true，避免刷新首帧因未完成初始化被重定向
  loading: true,
  error: null,
  init: async () => {
    set({ loading: true, error: null });
    try {
      const me = await authApi.me();
      set({ user: me, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '加载失败' });
    }
  },
  loginWithSms: async (phone, code) => {
    set({ loading: true, error: null });
    try {
      const { user } = await authApi.loginWithSms({ phone, code });
      set({ user, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '登录失败' });
      throw e;
    }
  },
  login: async (phone, password) => {
    set({ loading: true, error: null });
    try {
      const { user } = await authApi.login({ phone, password });
      set({ user, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '登录失败' });
      throw e;
    }
  },
  register: async (phone, password, name, email) => {
    set({ loading: true, error: null });
    try {
      await authApi.register({ phone, password, name, email });
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
      set({ user: null, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '登出失败' });
    }
  }
}));
