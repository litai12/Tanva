import { create } from 'zustand';
import { projectApi, type Project } from '@/services/projectApi';
import { deleteProjectCache } from '@/services/projectCacheStore';
import { useTeamStore } from '@/stores/teamStore';
import i18n from '@/i18n';

type ProjectState = {
  projects: Project[];
  recentProjectIds: string[];
  currentProjectId: string | null;
  currentProject: Project | null;
  loading: boolean;
  modalOpen: boolean;
  error: string | null;
  load: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  create: (name?: string) => Promise<Project>;
  open: (id: string) => void;
  rename: (id: string, name: string) => Promise<void>;
  updateMeta: (id: string, payload: { name?: string; thumbnailUrl?: string | null }) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  optimisticRenameLocal: (id: string, name: string) => void;
};

const LS_CURRENT_PROJECT = 'current_project_id';
const LS_RECENT_PROJECT_IDS = 'tanva_recent_project_ids';
const MAX_RECENT_PROJECT_IDS = 5;

const normalizeRecentProjectIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_RECENT_PROJECT_IDS) break;
  }
  return ids;
};

const readRecentProjectIds = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_RECENT_PROJECT_IDS);
    if (!raw) return [];
    return normalizeRecentProjectIds(JSON.parse(raw));
  } catch {
    return [];
  }
};

const writeRecentProjectIds = (ids: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LS_RECENT_PROJECT_IDS,
      JSON.stringify(normalizeRecentProjectIds(ids))
    );
  } catch {}
};

const rememberRecentProjectId = (
  projectId: string,
  currentIds: string[] = readRecentProjectIds()
): string[] => {
  const id = projectId.trim();
  if (!id) return normalizeRecentProjectIds(currentIds);
  return normalizeRecentProjectIds([
    id,
    ...currentIds.filter((existingId) => existingId !== id),
  ]);
};

const filterExistingRecentProjectIds = (
  ids: string[],
  projects: Project[]
): string[] => {
  const existingIds = new Set(projects.map((project) => project.id));
  return normalizeRecentProjectIds(ids.filter((id) => existingIds.has(id)));
};

const getErrorMessage = (error: unknown, fallback: string | null): string | null => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error !== 'object' || error === null) return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : fallback;
};

const getDefaultProjectName = (): string => {
  const translated = String(
    i18n.t('workspacePage.prompt.defaultName', {
      defaultValue: '未命名项目',
    }) || ''
  ).trim();
  return translated || '未命名项目';
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  recentProjectIds: readRecentProjectIds(),
  currentProjectId: null,
  currentProject: null,
  loading: false,
  modalOpen: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const { activeTeamId, teams } = useTeamStore.getState();
      const activeTeam = teams.find((t) => t.id === activeTeamId);
      const isOrgTeam = activeTeam && !activeTeam.isPersonal;
      const projects = isOrgTeam
        ? await projectApi.listByTeam(activeTeam.id)
        : await projectApi.list();
      let recentProjectIds = filterExistingRecentProjectIds(
        readRecentProjectIds(),
        projects
      );
      const savedId = localStorage.getItem(LS_CURRENT_PROJECT);
      let current: Project | null = null;
      if (savedId) current = projects.find((p) => p.id === savedId) || null;

      if (!current) {
        if (projects.length > 0) {
          current = projects[0];
          try { localStorage.setItem(LS_CURRENT_PROJECT, current.id); } catch {}
        } else if (isOrgTeam) {
          // 团队模式下没有共享项目时不自动创建个人项目
          writeRecentProjectIds(recentProjectIds);
          set({ projects: [], recentProjectIds, currentProjectId: null, currentProject: null, loading: false });
          return;
        } else {
          // 没有项目，自动创建一个"未命名"
          try {
            const project = await projectApi.create({ name: getDefaultProjectName() });
            const all = [project, ...projects];
            recentProjectIds = rememberRecentProjectId(project.id, recentProjectIds);
            writeRecentProjectIds(recentProjectIds);
            set({
              projects: all,
              recentProjectIds,
              currentProjectId: project.id,
              currentProject: project,
              loading: false,
            });
            try { localStorage.setItem(LS_CURRENT_PROJECT, project.id); } catch {}
            return;
          } catch (err: unknown) {
            writeRecentProjectIds(recentProjectIds);
            set({
              projects,
              recentProjectIds,
              currentProjectId: null,
              currentProject: null,
              loading: false,
              error: getErrorMessage(err, null),
              modalOpen: true,
            });
            return;
          }
        }
      }

      if (current) {
        recentProjectIds = rememberRecentProjectId(current.id, recentProjectIds);
      }
      writeRecentProjectIds(recentProjectIds);

      set({
        projects,
        recentProjectIds,
        currentProjectId: current?.id || null,
        currentProject: current || null,
        loading: false,
      });
    } catch (e: unknown) {
      set({ loading: false, error: getErrorMessage(e, '加载项目失败') });
    }
  },

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  create: async (name?: string) => {
    const normalizedName = name?.trim();
    const project = await projectApi.create({ name: normalizedName || getDefaultProjectName() });
    const recentProjectIds = rememberRecentProjectId(
      project.id,
      get().recentProjectIds
    );
    writeRecentProjectIds(recentProjectIds);
    set((s) => ({ projects: [project, ...s.projects], recentProjectIds }));
    get().open(project.id);
    return project;
  },

  open: (id: string) => {
    const found = get().projects.find((x) => x.id === id) || null;

    if (found) {
      const recentProjectIds = rememberRecentProjectId(
        found.id,
        get().recentProjectIds
      );
      writeRecentProjectIds(recentProjectIds);
      set({
        currentProjectId: found.id,
        currentProject: found,
        recentProjectIds,
        modalOpen: false,
      });
      try { localStorage.setItem(LS_CURRENT_PROJECT, found.id); } catch {}
      return;
    }

    // 未在本地列表中，尝试从后端获取并补充
    (async () => {
      try {
        const proj = await projectApi.get(id);
        set((s) => {
          const exists = s.projects.some((p) => p.id === proj.id);
          const projects = exists ? s.projects.map((p) => p.id === proj.id ? proj : p) : [proj, ...s.projects];
          const recentProjectIds = rememberRecentProjectId(
            proj.id,
            s.recentProjectIds
          );
          writeRecentProjectIds(recentProjectIds);
          return {
            projects,
            recentProjectIds,
            currentProjectId: proj.id,
            currentProject: proj,
            modalOpen: false, // 确保关闭模态框
            error: null // 清除任何之前的错误
          };
        });
        try { localStorage.setItem(LS_CURRENT_PROJECT, id); } catch {}
      } catch (e: unknown) {
        console.warn('Failed to load project:', e);
        set({ error: getErrorMessage(e, '无法加载项目'), modalOpen: true });
      }
    })();
  },

  updateMeta: async (id, payload) => {
    try {
      const project = await projectApi.update(id, payload);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? project : p)),
        currentProject: s.currentProject?.id === id ? project : s.currentProject,
        error: null,
      }));
      return project;
    } catch (e: unknown) {
      console.warn('Failed to update project meta:', e);
      set({ error: getErrorMessage(e, '更新项目信息失败') });
      throw e;
    }
  },
  rename: async (id, name) => {
    await get().updateMeta(id, { name });
  },

  remove: async (id) => {
    await projectApi.remove(id);

    // 清理本地缓存
    deleteProjectCache(id).catch(() => {});

    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id);
      const removedCurrent = state.currentProjectId === id;
      const recentProjectIds = filterExistingRecentProjectIds(
        state.recentProjectIds.filter((projectId) => projectId !== id),
        projects
      );
      writeRecentProjectIds(recentProjectIds);

      if (removedCurrent) {
        try { localStorage.removeItem(LS_CURRENT_PROJECT); } catch {}
      }

      return {
        projects,
        recentProjectIds,
        currentProjectId: removedCurrent ? null : state.currentProjectId,
        currentProject: removedCurrent ? null : state.currentProject,
        modalOpen: projects.length === 0 ? true : state.modalOpen
      };
    });

    const stateAfterRemoval = get();

    if (stateAfterRemoval.projects.length === 0) {
      try {
        const fallback = await projectApi.create({ name: getDefaultProjectName() });
        const recentProjectIds = rememberRecentProjectId(
          fallback.id,
          get().recentProjectIds
        );
        writeRecentProjectIds(recentProjectIds);
        set({
          projects: [fallback],
          recentProjectIds,
          currentProjectId: fallback.id,
          currentProject: fallback,
          modalOpen: true,
        });
        try { localStorage.setItem(LS_CURRENT_PROJECT, fallback.id); } catch {}
      } catch (error) {
        console.warn('自动创建新项目失败:', error);
      }
      return;
    }

    if (!stateAfterRemoval.currentProjectId) {
      const fallback = stateAfterRemoval.projects[0];
      const recentProjectIds = rememberRecentProjectId(
        fallback.id,
        stateAfterRemoval.recentProjectIds
      );
      writeRecentProjectIds(recentProjectIds);
      set({
        recentProjectIds,
        currentProjectId: fallback.id,
        currentProject: fallback,
      });
      try { localStorage.setItem(LS_CURRENT_PROJECT, fallback.id); } catch {}
    } else if (stateAfterRemoval.currentProjectId !== id) {
      try { localStorage.setItem(LS_CURRENT_PROJECT, stateAfterRemoval.currentProjectId); } catch {}
    }
  },
  optimisticRenameLocal: (id, name) => set((s) => ({
    projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)),
    currentProject: s.currentProject?.id === id ? { ...(s.currentProject as Project), name } : s.currentProject,
  })),
}));
