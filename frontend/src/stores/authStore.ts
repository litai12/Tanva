import { create } from 'zustand';
import { authApi, type UserInfo } from '@/services/authApi';
import { clearTokens } from '@/services/authTokenStorage';
import { teamApi } from '@/services/teamApi';
import { useTeamStore } from './teamStore';

type AuthState = {
  user: UserInfo | null;
  loading: boolean;
  initializing: boolean; // 区分初始化加载和操作加载
  error: string | null;
  connection: 'mock' | 'server' | 'refresh' | 'local' | null;
  setAuthenticatedUser: (user: UserInfo, connection?: AuthState['connection']) => void;
  init: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  loginWithSms: (phone: string, code: string) => Promise<void>;
  register: (phone: string, password: string, code: string, name: string, email?: string, inviteCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  forceLogout: (reason?: string) => void;
};

export async function refreshTeams() {
  return loadTeams();
}

async function loadTeams() {
  try {
    const teams = await teamApi.getMyTeams();
    const { setTeams, setActiveTeamId, activeTeamId } = useTeamStore.getState();
    setTeams(teams);
    // 只在没有 activeTeamId 或 activeTeamId 不在当前团队列表时，默认设为个人团队
    if (!activeTeamId || !teams.find((t: any) => t.id === activeTeamId)) {
      const personal = teams.find((t: any) => t.isPersonal);
      if (personal) setActiveTeamId(personal.id);
    }
    // 注意：不在此处触发 projectStore.load()。
    // teams 已持久化到 localStorage，load() 首次调用时就能拿到正确的团队列表，
    // 不再需要 loadTeams() 完成后的补救性 reload（它会产生竞态，覆盖 URL 导航）。
  } catch (e) {
    console.warn('[loadTeams] failed:', e);
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // 初始为 false，采用延迟初始化（只有进入受保护路由或登录时才触发）
  loading: false,
  initializing: false, // 初始化状态
  error: null,
  connection: null,
  setAuthenticatedUser: (user, connection = 'server') => {
    set({ user, connection, error: null, loading: false, initializing: false });
  },
  init: async () => {
    set({ initializing: true, error: null });
    try {
      // 详细来源：server / refresh / local / mock
      const { user, source } = await (authApi as any).meDetailed?.() ?? { user: await authApi.me(), source: null };
      set({ user, initializing: false, connection: (source as any) || null });
      void loadTeams();
    } catch (e: any) {
      set({ initializing: false, error: e?.message || '加载失败' });
    }
  },
  loginWithSms: async (phone, code) => {
    set({ loading: true, error: null });
    try {
      const { user } = await authApi.loginWithSms({ phone, code });
      set({ user, loading: false, connection: 'server' });
      void loadTeams();
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
      void loadTeams();
    } catch (e: any) {
      set({ loading: false, error: e?.message || '登录失败' });
      throw e;
    }
  },
  register: async (phone, password, code, name, email, inviteCode) => {
    set({ loading: true, error: null });
    try {
      await authApi.register({ phone, password, code, name, email, inviteCode });
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
      useTeamStore.getState().setTeams([]);
      useTeamStore.getState().setActiveTeamId(null);
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
    try {
      localStorage.removeItem('mock_user');
      localStorage.removeItem('token_expiry');
      localStorage.removeItem('last_auth_at');
      clearTokens();
    } catch {}
    useTeamStore.getState().setTeams([]);
    useTeamStore.getState().setActiveTeamId(null);
  }
}));
