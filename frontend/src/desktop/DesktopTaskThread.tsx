import { useEffect, useState } from 'react';
import {
  BriefcaseBusiness,
  Check,
  MessageSquare,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import AIChatDialog from '@/components/chat/AIChatDialog';
import RuntimeErrorBoundary from '@/components/RuntimeErrorBoundary';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTeamStore } from '@/stores/teamStore';
import { useDesktopSurfaceStore } from './plugins/surfaceState';
import { TANVA_CANVAS_PLUGIN_ID } from './plugins/builtins';
import {
  DESKTOP_PROJECT_CREATION_REQUEST_EVENT,
  resolveDesktopTaskMode,
  useDesktopTaskContextStore,
  type DesktopTaskMode,
} from './taskContextState';

export default function DesktopTaskThread() {
  const sessions = useAIChatStore((state) => state.sessions);
  const currentSessionId = useAIChatStore((state) => state.currentSessionId);
  const showDialog = useAIChatStore((state) => state.showDialog);
  const setXiaotMode = useAIChatStore((state) => state.setXiaotMode);
  const xiaotModel = useAIChatStore((state) => state.xiaotModel);
  const setXiaotModel = useAIChatStore((state) => state.setXiaotModel);
  const renameCurrentSession = useAIChatStore((state) => state.renameCurrentSession);
  const deleteSession = useAIChatStore((state) => state.deleteSession);
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const openProject = useProjectStore((state) => state.open);
  const projectBySessionId = useDesktopTaskContextStore((state) => state.projectBySessionId);
  const modeBySessionId = useDesktopTaskContextStore((state) => state.modeBySessionId);
  const bindTaskProject = useDesktopTaskContextStore((state) => state.bindProject);
  const moveTaskToChat = useDesktopTaskContextStore((state) => state.moveToChat);
  const setTaskMode = useDesktopTaskContextStore((state) => state.setMode);
  const removeTaskContext = useDesktopTaskContextStore((state) => state.removeSession);
  const sidebarVisible = useDesktopTaskContextStore((state) => state.sidebarVisible);
  const toggleSidebar = useDesktopTaskContextStore((state) => state.toggleSidebar);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const teams = useTeamStore((state) => state.teams);
  const setActiveTeamId = useTeamStore((state) => state.setActiveTeamId);
  const closeSurface = useDesktopSurfaceStore((state) => state.close);
  const dismissSurface = useDesktopSurfaceStore((state) => state.dismiss);
  const openSurface = useDesktopSurfaceStore((state) => state.open);
  const activePluginId = useDesktopSurfaceStore((state) => state.activePluginId);
  const surfaceMode = useDesktopSurfaceStore((state) => state.mode);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const currentSession = sessions.find((session) => session.sessionId === currentSessionId);
  const taskProjectId = currentSessionId ? projectBySessionId[currentSessionId] : null;
  const taskMode = resolveDesktopTaskMode(currentSessionId, {
    ...useDesktopTaskContextStore.getState(),
    modeBySessionId,
    projectBySessionId,
  });
  const isCanvasOpen =
    surfaceMode !== 'closed' && activePluginId === TANVA_CANVAS_PLUGIN_ID;
  const hasProject = Boolean(taskProjectId || currentProjectId);

  useEffect(() => {
    showDialog();
    setXiaotMode(true);
  }, [setXiaotMode, showDialog]);

  useEffect(() => {
    // DeepSeek facade 当前可能因独立路由额度返回 402。桌面端先落到已验证
    // 可用的 Luna，runXiaotAgent 仍会在运行时做一次同样的自动恢复。
    if (xiaotModel === 'xiaot-agent-deepseek-v4-flash') {
      setXiaotModel('xiaot-agent-gpt-5-6-luna');
    }
  }, [setXiaotModel, xiaotModel]);

  useEffect(() => {
    if (!currentSessionId || taskMode !== 'work' || !taskProjectId) return;
    const project = projects.find((item) => item.id === taskProjectId);
    const personalTeamId = teams.find((team) => team.isPersonal)?.id ?? null;
    const desiredTeamId = project?.teamId ?? personalTeamId;
    if (desiredTeamId && desiredTeamId !== activeTeamId) {
      setActiveTeamId(desiredTeamId);
      void useProjectStore.getState().load().then(() => {
        useProjectStore.getState().open(taskProjectId);
      });
      return;
    }
    if (taskProjectId !== currentProjectId) openProject(taskProjectId);
  }, [
    activeTeamId,
    currentProjectId,
    currentSessionId,
    openProject,
    projects,
    setActiveTeamId,
    taskMode,
    taskProjectId,
    teams,
  ]);

  useEffect(() => {
    setShowMenu(false);
    setIsRenaming(false);
    setConfirmDelete(false);
  }, [currentSessionId]);

  useEffect(() => {
    if (!showMenu) return undefined;
    const dismiss = () => {
      setShowMenu(false);
      setIsRenaming(false);
      setConfirmDelete(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('[data-desktop-task-menu-root]')) {
        dismiss();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', dismiss);
    };
  }, [showMenu]);

  const changeProject = (projectId: string) => {
    if (!currentSessionId || !projectId) return;
    bindTaskProject(currentSessionId, projectId);
    closeSurface();
    openProject(projectId);
  };

  const changeTaskMode = (mode: DesktopTaskMode) => {
    if (!currentSessionId || mode === taskMode) return;
    closeSurface();
    if (mode === 'chat') {
      moveTaskToChat(currentSessionId);
      return;
    }
    const projectId = currentProjectId || projects[0]?.id;
    if (!projectId) {
      window.dispatchEvent(new CustomEvent(DESKTOP_PROJECT_CREATION_REQUEST_EVENT, {
        detail: { sessionId: currentSessionId },
      }));
      return;
    }
    setTaskMode(currentSessionId, 'work');
    bindTaskProject(currentSessionId, projectId);
  };

  const beginRename = () => {
    setRenameValue(currentSession?.name || '');
    setIsRenaming(true);
    setConfirmDelete(false);
  };

  const submitRename = async () => {
    const name = renameValue.trim();
    if (!name) return;
    await renameCurrentSession(name);
    setIsRenaming(false);
    setShowMenu(false);
  };

  const removeCurrentTask = async () => {
    if (!currentSessionId) return;
    const removedId = currentSessionId;
    closeSurface();
    await deleteSession(removedId);
    removeTaskContext(removedId);
    setShowMenu(false);
  };

  const toggleCanvas = () => {
    if (isCanvasOpen) {
      dismissSurface(TANVA_CANVAS_PLUGIN_ID);
      return;
    }
    openSurface(TANVA_CANVAS_PLUGIN_ID, 'docked');
  };

  return (
    <main className="flex min-w-[420px] flex-1 flex-col overflow-hidden bg-white">
      <header className={`flex h-12 flex-none items-center gap-2 overflow-hidden border-b border-slate-200 pr-4 ${sidebarVisible ? 'pl-4' : 'pl-20'}`}>
        {!sidebarVisible && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            title="展开侧栏 (⌘B)"
            aria-label="展开侧栏"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">
            {currentSession?.name || '新任务'}
          </div>
        </div>
        <div className="flex h-8 flex-none items-center whitespace-nowrap rounded-lg bg-slate-100 p-0.5" aria-label="任务类型">
          <button
            type="button"
            onClick={() => changeTaskMode('work')}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium ${
              taskMode === 'work'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            aria-pressed={taskMode === 'work'}
          >
            <BriefcaseBusiness className="h-3 w-3" /> Work
          </button>
          <button
            type="button"
            onClick={() => changeTaskMode('chat')}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium ${
              taskMode === 'chat'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            aria-pressed={taskMode === 'chat'}
          >
            <MessageSquare className="h-3 w-3" /> Chat
          </button>
        </div>
        {taskMode === 'work' && (
          <>
            <label className="flex h-8 w-[132px] min-w-0 flex-none items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-600 hover:border-slate-300">
              <select
                value={taskProjectId || currentProjectId || ''}
                onChange={(event) => changeProject(event.target.value)}
                className="w-full min-w-0 truncate bg-transparent outline-none"
                aria-label="当前项目上下文"
              >
                {!currentProjectId && <option value="">选择项目</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={toggleCanvas}
              className={`flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 text-xs font-medium transition-colors ${
                isCanvasOpen
                  ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950'
              }`}
              title={
                isCanvasOpen
                  ? '收起当前项目画布'
                  : hasProject
                    ? '展开当前项目画布'
                    : '展开画布（尚未选择项目）'
              }
              aria-pressed={isCanvasOpen}
            >
              {isCanvasOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
              {isCanvasOpen ? '隐藏' : '画布'}
            </button>
          </>
        )}
        <div className="relative" data-desktop-task-menu-root>
          <button
            type="button"
            onClick={() => setShowMenu((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            title="任务操作"
            aria-expanded={showMenu}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-10 z-[130] w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              {isRenaming ? (
                <form
                  className="flex items-center gap-1"
                  onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    if (renameValue.trim()) {
                      void submitRename();
                    } else {
                      setIsRenaming(false);
                    }
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitRename();
                  }}
                >
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-blue-500"
                    aria-label="任务名称"
                  />
                  <button type="submit" className="flex h-9 w-9 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50" title="保存名称">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setIsRenaming(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" title="取消">
                    <X className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <>
                  <button type="button" onClick={beginRename} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100">
                    <Pencil className="h-3.5 w-3.5" />
                    重命名任务
                  </button>
                  {confirmDelete ? (
                    <div className="mt-1 rounded-lg bg-red-50 p-2">
                      <div className="text-[11px] leading-4 text-red-700">删除后无法恢复，确认删除这个任务？</div>
                      <div className="mt-2 flex justify-end gap-1">
                        <button type="button" onClick={() => setConfirmDelete(false)} className="h-7 rounded-md px-2 text-[11px] text-slate-600 hover:bg-white">取消</button>
                        <button type="button" onClick={() => void removeCurrentTask()} className="h-7 rounded-md bg-red-600 px-2 text-[11px] font-medium text-white hover:bg-red-700">确认删除</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(true)} className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-xs text-red-600 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" />
                      删除任务
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <RuntimeErrorBoundary label="小T任务线程" resetKeys={[currentSessionId, currentProjectId]}>
          <AIChatDialog presentation="embedded" />
        </RuntimeErrorBoundary>
      </div>
    </main>
  );
}
