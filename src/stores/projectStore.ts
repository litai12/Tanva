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
    const p = get().projects.find((x) => x.id === id) || null;
    set({ currentProjectId: p?.id || null, currentProject: p, modalOpen: false });
    try { if (p) localStorage.setItem(LS_CURRENT_PROJECT, p.id); } catch {}
  },

  rename: async (id, name) => {
    const project = await projectApi.update(id, { name });
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? project : p)),
      currentProject: s.currentProject?.id === id ? project : s.currentProject,
    }));
  },

  remove: async (id) => {
    await projectApi.remove(id);
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      const isCurrent = s.currentProjectId === id;
      const current = isCurrent ? null : s.currentProject;
      if (isCurrent) try { localStorage.removeItem(LS_CURRENT_PROJECT); } catch {}
      return { projects, currentProjectId: current?.id || null, currentProject: current };
    });
  },
  optimisticRenameLocal: (id, name) => set((s) => ({
    projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)),
    currentProject: s.currentProject?.id === id ? { ...(s.currentProject as Project), name } : s.currentProject,
  })),
}));
