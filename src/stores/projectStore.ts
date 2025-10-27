import { create } from 'zustand';
import { projectApi, type Project } from '@/services/projectApi';

type ProjectState = {
  projects: Project[];
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
  remove: (id: string) => Promise<void>;
  optimisticRenameLocal: (id: string, name: string) => void;
};

const LS_CURRENT_PROJECT = 'current_project_id';

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  currentProject: null,
  loading: false,
  modalOpen: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await projectApi.list();
      const savedId = localStorage.getItem(LS_CURRENT_PROJECT);
      let current: Project | null = null;
      if (savedId) current = projects.find((p) => p.id === savedId) || null;

      if (!current) {
        if (projects.length > 0) {
          current = projects[0];
          try { localStorage.setItem(LS_CURRENT_PROJECT, current.id); } catch {}
        } else {
          // 没有项目，自动创建一个"未命名"
          try {
            const project = await projectApi.create({ name: '未命名' });
            const all = [project, ...projects];
            set({ projects: all, currentProjectId: project.id, currentProject: project, loading: false });
            try { localStorage.setItem(LS_CURRENT_PROJECT, project.id); } catch {}
            return;
          } catch (err: any) {
            set({ projects, currentProjectId: null, currentProject: null, loading: false, error: err?.message || null, modalOpen: true });
            return;
          }
        }
      }

      set({ projects, currentProjectId: current?.id || null, currentProject: current || null, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '加载项目失败' });
    }
  },

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  create: async (name?: string) => {
    const project = await projectApi.create({ name });
    set((s) => ({ projects: [project, ...s.projects] }));
    get().open(project.id);
    return project;
  },

  open: (id: string) => {
    const found = get().projects.find((x) => x.id === id) || null;

    if (found) {
      set({ currentProjectId: found.id, currentProject: found, modalOpen: false });
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
          return {
            projects,
            currentProjectId: proj.id,
            currentProject: proj,
            modalOpen: false, // 确保关闭模态框
            error: null // 清除任何之前的错误
          };
        });
        try { localStorage.setItem(LS_CURRENT_PROJECT, id); } catch {}
      } catch (e: any) {
        console.warn('Failed to load project:', e);
        set({ error: e?.message || '无法加载项目', modalOpen: true });
      }
    })();
  },

  rename: async (id, name) => {
    try {
      const project = await projectApi.update(id, { name });
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? project : p)),
        currentProject: s.currentProject?.id === id ? project : s.currentProject,
        error: null // 清除任何错误
      }));
    } catch (e: any) {
      console.warn('Failed to rename project:', e);
      set({ error: e?.message || '重命名失败' });
      throw e; // 重新抛出错误让调用者处理
    }
  },

  remove: async (id) => {
    await projectApi.remove(id);

    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id);
      const removedCurrent = state.currentProjectId === id;

      if (removedCurrent) {
        try { localStorage.removeItem(LS_CURRENT_PROJECT); } catch {}
      }

      return {
        projects,
        currentProjectId: removedCurrent ? null : state.currentProjectId,
        currentProject: removedCurrent ? null : state.currentProject,
        modalOpen: projects.length === 0 ? true : state.modalOpen
      };
    });

    const stateAfterRemoval = get();

    if (stateAfterRemoval.projects.length === 0) {
      try {
        const fallback = await projectApi.create({ name: '未命名' });
        set({
          projects: [fallback],
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
      set({
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
