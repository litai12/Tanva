import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DesktopTaskMode = 'work' | 'chat';

interface DesktopTaskContextState {
  projectBySessionId: Record<string, string>;
  modeBySessionId: Record<string, DesktopTaskMode>;
  collapsedProjectIds: Record<string, boolean>;
  pinnedProjectIds: Record<string, boolean>;
  pinnedSessionIds: Record<string, boolean>;
  archivedSessionIds: Record<string, boolean>;
  workCollapsed: boolean;
  chatCollapsed: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
  bindProject: (sessionId: string, projectId: string) => void;
  moveToChat: (sessionId: string) => void;
  setMode: (sessionId: string, mode: DesktopTaskMode) => void;
  removeSession: (sessionId: string) => void;
  removeProject: (projectId: string) => void;
  toggleProjectCollapsed: (projectId: string) => void;
  toggleProjectPinned: (projectId: string) => void;
  toggleSessionPinned: (sessionId: string) => void;
  setSessionArchived: (sessionId: string, archived: boolean) => void;
  toggleWorkCollapsed: () => void;
  toggleChatCollapsed: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
}

export const DESKTOP_PROJECT_CREATION_REQUEST_EVENT = 'tanva:desktop-request-project-creation';

export const useDesktopTaskContextStore = create<DesktopTaskContextState>()(
  persist(
    (set) => ({
      projectBySessionId: {},
      modeBySessionId: {},
      collapsedProjectIds: {},
      pinnedProjectIds: {},
      pinnedSessionIds: {},
      archivedSessionIds: {},
      workCollapsed: false,
      chatCollapsed: false,
      sidebarVisible: true,
      sidebarWidth: 272,
      bindProject: (sessionId, projectId) =>
        set((state) => ({
          projectBySessionId: {
            ...state.projectBySessionId,
            [sessionId]: projectId,
          },
          modeBySessionId: {
            ...state.modeBySessionId,
            [sessionId]: 'work',
          },
          collapsedProjectIds: {
            ...state.collapsedProjectIds,
            [projectId]: false,
          },
          workCollapsed: false,
        })),
      moveToChat: (sessionId) =>
        set((state) => {
          const projectBySessionId = { ...state.projectBySessionId };
          delete projectBySessionId[sessionId];
          return {
            projectBySessionId,
            modeBySessionId: {
              ...state.modeBySessionId,
              [sessionId]: 'chat',
            },
          };
        }),
      setMode: (sessionId, mode) =>
        set((state) => {
          if (mode === 'chat') {
            const projectBySessionId = { ...state.projectBySessionId };
            delete projectBySessionId[sessionId];
            return {
              projectBySessionId,
              modeBySessionId: {
                ...state.modeBySessionId,
                [sessionId]: 'chat',
              },
            };
          }
          return {
            modeBySessionId: {
              ...state.modeBySessionId,
              [sessionId]: 'work',
            },
          };
        }),
      removeSession: (sessionId) =>
        set((state) => {
          const projectBySessionId = { ...state.projectBySessionId };
          const modeBySessionId = { ...state.modeBySessionId };
          const pinnedSessionIds = { ...state.pinnedSessionIds };
          const archivedSessionIds = { ...state.archivedSessionIds };
          delete projectBySessionId[sessionId];
          delete modeBySessionId[sessionId];
          delete pinnedSessionIds[sessionId];
          delete archivedSessionIds[sessionId];
          return { projectBySessionId, modeBySessionId, pinnedSessionIds, archivedSessionIds };
        }),
      removeProject: (projectId) =>
        set((state) => {
          const projectBySessionId = { ...state.projectBySessionId };
          const modeBySessionId = { ...state.modeBySessionId };
          for (const [sessionId, boundProjectId] of Object.entries(projectBySessionId)) {
            if (boundProjectId !== projectId) continue;
            delete projectBySessionId[sessionId];
            modeBySessionId[sessionId] = 'chat';
          }
          const collapsedProjectIds = { ...state.collapsedProjectIds };
          const pinnedProjectIds = { ...state.pinnedProjectIds };
          delete collapsedProjectIds[projectId];
          delete pinnedProjectIds[projectId];
          return { projectBySessionId, modeBySessionId, collapsedProjectIds, pinnedProjectIds };
        }),
      toggleProjectCollapsed: (projectId) =>
        set((state) => ({
          collapsedProjectIds: {
            ...state.collapsedProjectIds,
            [projectId]: !state.collapsedProjectIds[projectId],
          },
        })),
      toggleProjectPinned: (projectId) =>
        set((state) => ({
          pinnedProjectIds: {
            ...state.pinnedProjectIds,
            [projectId]: !state.pinnedProjectIds[projectId],
          },
        })),
      toggleSessionPinned: (sessionId) =>
        set((state) => ({
          pinnedSessionIds: {
            ...state.pinnedSessionIds,
            [sessionId]: !state.pinnedSessionIds[sessionId],
          },
        })),
      setSessionArchived: (sessionId, archived) =>
        set((state) => {
          const archivedSessionIds = { ...state.archivedSessionIds };
          const pinnedSessionIds = { ...state.pinnedSessionIds };
          if (archived) {
            archivedSessionIds[sessionId] = true;
            delete pinnedSessionIds[sessionId];
          } else {
            delete archivedSessionIds[sessionId];
          }
          return { archivedSessionIds, pinnedSessionIds };
        }),
      toggleWorkCollapsed: () =>
        set((state) => ({ workCollapsed: !state.workCollapsed })),
      toggleChatCollapsed: () =>
        set((state) => ({ chatCollapsed: !state.chatCollapsed })),
      toggleSidebar: () =>
        set((state) => ({ sidebarVisible: !state.sidebarVisible })),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(232, Math.min(420, Math.round(width))) }),
    }),
    {
      name: 'tanva:desktop-task-context:v1',
      partialize: (state) => ({
        projectBySessionId: state.projectBySessionId,
        modeBySessionId: state.modeBySessionId,
        collapsedProjectIds: state.collapsedProjectIds,
        pinnedProjectIds: state.pinnedProjectIds,
        pinnedSessionIds: state.pinnedSessionIds,
        archivedSessionIds: state.archivedSessionIds,
        workCollapsed: state.workCollapsed,
        chatCollapsed: state.chatCollapsed,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
      }),
    }
  )
);

export const resolveDesktopTaskMode = (
  sessionId: string | null | undefined,
  state = useDesktopTaskContextStore.getState()
): DesktopTaskMode => {
  if (!sessionId) return 'chat';
  return state.modeBySessionId[sessionId] ||
    (state.projectBySessionId[sessionId] ? 'work' : 'chat');
};
