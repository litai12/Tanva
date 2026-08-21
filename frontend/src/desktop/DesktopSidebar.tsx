import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Archive,
  ArchiveRestore,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Folder,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTeamStore } from '@/stores/teamStore';
import { getMyCredits } from '@/services/adminApi';
import { publicAssetUrl } from '@/utils/publicAssetUrl';
import { useDesktopPlugins } from './plugins/registry';
import { useDesktopSurfaceStore } from './plugins/surfaceState';
import {
  DESKTOP_PROJECT_CREATION_REQUEST_EVENT,
  useDesktopTaskContextStore,
} from './taskContextState';

const dragStyle = {
  WebkitAppRegion: 'drag',
} as CSSProperties & { WebkitAppRegion: string };

const noDragStyle = {
  WebkitAppRegion: 'no-drag',
} as CSSProperties & { WebkitAppRegion: string };

const isToday = (value: Date): boolean => {
  const now = new Date();
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate()
  );
};

export default function DesktopSidebar() {
  const sessions = useAIChatStore((state) => state.sessions);
  const currentSessionId = useAIChatStore((state) => state.currentSessionId);
  const createSession = useAIChatStore((state) => state.createSession);
  const switchSession = useAIChatStore((state) => state.switchSession);
  const renameSession = useAIChatStore((state) => state.renameSession);
  const deleteSession = useAIChatStore((state) => state.deleteSession);
  const showDialog = useAIChatStore((state) => state.showDialog);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const teams = useTeamStore((state) => state.teams);
  const activeTeamId = useTeamStore((state) => state.activeTeamId);
  const setActiveTeamId = useTeamStore((state) => state.setActiveTeamId);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const projects = useProjectStore((state) => state.projects);
  const createProject = useProjectStore((state) => state.create);
  const renameProject = useProjectStore((state) => state.rename);
  const deleteProject = useProjectStore((state) => state.remove);
  const openProject = useProjectStore((state) => state.open);
  const closeSurface = useDesktopSurfaceStore((state) => state.close);
  const openSurface = useDesktopSurfaceStore((state) => state.open);
  const projectBySessionId = useDesktopTaskContextStore((state) => state.projectBySessionId);
  const modeBySessionId = useDesktopTaskContextStore((state) => state.modeBySessionId);
  const bindTaskProject = useDesktopTaskContextStore((state) => state.bindProject);
  const moveTaskToChat = useDesktopTaskContextStore((state) => state.moveToChat);
  const setTaskMode = useDesktopTaskContextStore((state) => state.setMode);
  const removeProjectContext = useDesktopTaskContextStore((state) => state.removeProject);
  const collapsedProjectIds = useDesktopTaskContextStore((state) => state.collapsedProjectIds);
  const pinnedProjectIds = useDesktopTaskContextStore((state) => state.pinnedProjectIds);
  const pinnedSessionIds = useDesktopTaskContextStore((state) => state.pinnedSessionIds);
  const archivedSessionIds = useDesktopTaskContextStore((state) => state.archivedSessionIds);
  const toggleProjectCollapsed = useDesktopTaskContextStore((state) => state.toggleProjectCollapsed);
  const toggleProjectPinned = useDesktopTaskContextStore((state) => state.toggleProjectPinned);
  const toggleSessionPinned = useDesktopTaskContextStore((state) => state.toggleSessionPinned);
  const setSessionArchived = useDesktopTaskContextStore((state) => state.setSessionArchived);
  const removeTaskContext = useDesktopTaskContextStore((state) => state.removeSession);
  const workCollapsed = useDesktopTaskContextStore((state) => state.workCollapsed);
  const toggleWorkCollapsed = useDesktopTaskContextStore((state) => state.toggleWorkCollapsed);
  const chatCollapsed = useDesktopTaskContextStore((state) => state.chatCollapsed);
  const toggleChatCollapsed = useDesktopTaskContextStore((state) => state.toggleChatCollapsed);
  const sidebarWidth = useDesktopTaskContextStore((state) => state.sidebarWidth);
  const setSidebarWidth = useDesktopTaskContextStore((state) => state.setSidebarWidth);
  const toggleSidebar = useDesktopTaskContextStore((state) => state.toggleSidebar);
  const plugins = useDesktopPlugins();
  const [query, setQuery] = useState('');
  const [showExtensions, setShowExtensions] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [personalCredits, setPersonalCredits] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectCreationSessionId, setProjectCreationSessionId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [creatingTaskProjectId, setCreatingTaskProjectId] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState('');
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);
  const [taskNameDraft, setTaskNameDraft] = useState('');
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [taskActionBusy, setTaskActionBusy] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? null;
  const displayedCredits = activeTeam && !activeTeam.isPersonal
    ? activeTeam.availableCredits
    : personalCredits;

  const beginProjectCreation = useCallback((sessionId: string | null = null) => {
    if (useDesktopTaskContextStore.getState().workCollapsed) {
      toggleWorkCollapsed();
    }
    setProjectCreationSessionId(sessionId);
    setNewProjectName('');
    setProjectActionError('');
    setProjectMenuId(null);
    setRenamingProjectId(null);
    setDeletingProjectId(null);
    setCreatingProject(true);
  }, [toggleWorkCollapsed]);

  useEffect(() => {
    const handleProjectCreationRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      beginProjectCreation(detail?.sessionId || null);
    };
    window.addEventListener(DESKTOP_PROJECT_CREATION_REQUEST_EVENT, handleProjectCreationRequest);
    return () =>
      window.removeEventListener(DESKTOP_PROJECT_CREATION_REQUEST_EVENT, handleProjectCreationRequest);
  }, [beginProjectCreation]);

  useEffect(() => {
    const dismissPopovers = () => {
      setProjectMenuId(null);
      setDeletingProjectId(null);
      setShowExtensions(false);
      setShowAccount(false);
      setTaskMenuId(null);
      setDeletingTaskId(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        projectMenuId &&
        !target.closest(`[data-desktop-project-menu-root="${projectMenuId}"]`)
      ) {
        setProjectMenuId(null);
        setDeletingProjectId(null);
      }
      if (showExtensions && !target.closest('[data-desktop-extensions-root]')) {
        setShowExtensions(false);
      }
      if (showAccount && !target.closest('[data-desktop-account-root]')) {
        setShowAccount(false);
      }
      if (taskMenuId && !target.closest(`[data-desktop-task-menu-root="${taskMenuId}"]`)) {
        setTaskMenuId(null);
        setDeletingTaskId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (renamingProjectId) {
        setRenamingProjectId(null);
        return;
      }
      if (renamingTaskId) {
        setRenamingTaskId(null);
        return;
      }
      if (creatingProject) {
        setCreatingProject(false);
        setProjectCreationSessionId(null);
        setNewProjectName('');
        return;
      }
      dismissPopovers();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', dismissPopovers);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', dismissPopovers);
    };
  }, [creatingProject, projectMenuId, renamingProjectId, renamingTaskId, showAccount, showExtensions, taskMenuId]);

  const submitProjectCreation = async () => {
    const name = newProjectName.trim();
    if (!name || projectActionBusy) return;
    setProjectActionBusy(true);
    setProjectActionError('');
    try {
      const project = await createProject(name);
      if (projectCreationSessionId) {
        bindTaskProject(projectCreationSessionId, project.id);
        if (projectCreationSessionId === currentSessionId) closeSurface();
      }
      openProject(project.id);
      setCreatingProject(false);
      setProjectCreationSessionId(null);
      setNewProjectName('');
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : '创建项目失败');
    } finally {
      setProjectActionBusy(false);
    }
  };

  const submitProjectRename = async (projectId: string) => {
    const name = projectNameDraft.trim();
    if (!name || projectActionBusy) return;
    setProjectActionBusy(true);
    setProjectActionError('');
    try {
      await renameProject(projectId, name);
      setRenamingProjectId(null);
      setProjectMenuId(null);
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : '重命名项目失败');
    } finally {
      setProjectActionBusy(false);
    }
  };

  const confirmProjectDeletion = async (projectId: string) => {
    if (projectActionBusy) return;
    setProjectActionBusy(true);
    setProjectActionError('');
    try {
      if (currentProjectId === projectId) closeSurface();
      await deleteProject(projectId);
      removeProjectContext(projectId);
      setDeletingProjectId(null);
      setProjectMenuId(null);
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : '删除项目失败');
    } finally {
      setProjectActionBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadCredits = () => {
      if (!user) return;
      void getMyCredits()
        .then((credits) => {
          if (!cancelled) setPersonalCredits(credits.balance);
        })
        .catch(() => {
          if (!cancelled) setPersonalCredits(null);
        });
    };
    loadCredits();
    window.addEventListener('refresh-credits', loadCredits);
    return () => {
      cancelled = true;
      window.removeEventListener('refresh-credits', loadCredits);
    };
  }, [user]);

  const switchTeam = async (teamId: string) => {
    if (teamId === activeTeamId) {
      setShowAccount(false);
      return;
    }
    closeSurface();
    setActiveTeamId(teamId);
    await useProjectStore.getState().load();
    setShowAccount(false);
  };

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sessions
      .filter((session) => !archivedSessionIds[session.sessionId])
      .filter((session) =>
        !normalized ||
        `${session.name} ${session.preview || ''}`.toLowerCase().includes(normalized)
      )
      .sort((a, b) => {
        const pinDelta = Number(Boolean(pinnedSessionIds[b.sessionId])) - Number(Boolean(pinnedSessionIds[a.sessionId]));
        return pinDelta || b.lastActivity.getTime() - a.lastActivity.getTime();
      });
  }, [archivedSessionIds, pinnedSessionIds, query, sessions]);

  const archivedSessions = useMemo(
    () => sessions.filter((session) => archivedSessionIds[session.sessionId]),
    [archivedSessionIds, sessions]
  );

  const orderedProjects = useMemo(
    () => [...projects].sort((a, b) => {
      const pinDelta = Number(Boolean(pinnedProjectIds[b.id])) - Number(Boolean(pinnedProjectIds[a.id]));
      return pinDelta || a.name.localeCompare(b.name, 'zh-CN');
    }),
    [pinnedProjectIds, projects]
  );

  const chatSessions = filteredSessions.filter((session) => {
    const explicitMode = modeBySessionId[session.sessionId];
    return explicitMode === 'chat' ||
      (!explicitMode && !projectBySessionId[session.sessionId]);
  });
  const todaySessions = chatSessions.filter((session) => isToday(new Date(session.lastActivity)));
  const recentSessions = chatSessions.filter((session) => !isToday(new Date(session.lastActivity)));
  const searchActiveSessionId = query.trim()
    ? filteredSessions[searchActiveIndex]?.sessionId ?? null
    : null;

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [query]);

  const startTask = useCallback(async () => {
    const sessionId = await createSession();
    setTaskMode(sessionId, 'chat');
    closeSurface();
    showDialog();
  }, [closeSurface, createSession, setTaskMode, showDialog]);

  const startProjectTask = async (project: (typeof projects)[number]) => {
    if (creatingTaskProjectId) return;
    setCreatingTaskProjectId(project.id);
    setProjectMenuId(null);
    setProjectActionError('');
    try {
      const sessionId = await createSession();
      // Project ownership must be established before the conversation is shown.
      // This keeps the brand-new task in the project tree from its first frame and
      // lets DesktopTaskThread hydrate the matching project context immediately.
      bindTaskProject(sessionId, project.id);
      closeSurface();
      openProject(project.id);
      showDialog();
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : '创建项目会话失败');
    } finally {
      setCreatingTaskProjectId(null);
    }
  };

  const selectTask = async (sessionId: string) => {
    closeSurface();
    await switchSession(sessionId);
    showDialog();
  };

  const submitTaskRename = async (sessionId: string) => {
    const name = taskNameDraft.trim();
    if (!name || taskActionBusy) return;
    setTaskActionBusy(true);
    try {
      await renameSession(sessionId, name);
      setRenamingTaskId(null);
      setTaskMenuId(null);
    } finally {
      setTaskActionBusy(false);
    }
  };

  const archiveTask = async (sessionId: string) => {
    setSessionArchived(sessionId, true);
    setTaskMenuId(null);
    setDeletingTaskId(null);
    if (sessionId !== currentSessionId) return;
    const next = sessions.find(
      (session) => session.sessionId !== sessionId && !archivedSessionIds[session.sessionId]
    );
    if (next) {
      await selectTask(next.sessionId);
      return;
    }
    await startTask();
  };

  const removeTask = async (sessionId: string) => {
    if (taskActionBusy) return;
    setTaskActionBusy(true);
    try {
      await deleteSession(sessionId);
      removeTaskContext(sessionId);
      setTaskMenuId(null);
      setDeletingTaskId(null);
    } finally {
      setTaskActionBusy(false);
    }
  };

  const moveTaskToProject = (sessionId: string, projectId: string) => {
    bindTaskProject(sessionId, projectId);
    setTaskMenuId(null);
    if (sessionId === currentSessionId) {
      closeSurface();
      openProject(projectId);
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void startTask();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [startTask]);

  const renderTaskButton = (
    session: (typeof sessions)[number],
    options: { archived?: boolean } = {}
  ) => (
    <div
      key={session.sessionId}
      data-desktop-task-menu-root={session.sessionId}
      className="group relative"
      draggable={!options.archived}
      onDragStart={(event) => {
        if (options.archived) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-tanva-session', session.sessionId);
        event.dataTransfer.setData('text/plain', session.sessionId);
      }}
      onDragEnd={() => setDragTarget(null)}
    >
      {renamingTaskId === session.sessionId ? (
        <form
          className="flex items-center gap-1 rounded-lg bg-white p-1 ring-1 ring-blue-200"
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            if (taskNameDraft.trim()) void submitTaskRename(session.sessionId);
            else setRenamingTaskId(null);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void submitTaskRename(session.sessionId);
          }}
        >
          <input
            autoFocus
            value={taskNameDraft}
            onChange={(event) => setTaskNameDraft(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-500"
            aria-label="会话名称"
          />
          <button type="submit" disabled={!taskNameDraft.trim() || taskActionBusy} className="flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 disabled:text-slate-300" title="保存会话名称">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setRenamingTaskId(null)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="取消重命名">
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : (
        <div
          className={cn(
            'flex rounded-lg transition-colors',
            currentSessionId === session.sessionId && !options.archived
              ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/80'
              : 'text-slate-600 hover:bg-white/70 hover:text-slate-950',
            searchActiveSessionId === session.sessionId &&
              'bg-blue-50 text-slate-950 ring-1 ring-blue-200'
          )}
        >
          <button
            type="button"
            onClick={() => {
              if (options.archived) return;
              void selectTask(session.sessionId);
            }}
            className="min-w-0 flex-1 px-2.5 py-2 text-left"
          >
            <div className="flex items-center gap-1.5">
              {pinnedSessionIds[session.sessionId] && !options.archived && (
                <Pin className="h-3 w-3 flex-none text-slate-400" />
              )}
              <span className="truncate text-[13px] font-medium">{session.name}</span>
            </div>
            {session.preview && (
              <div className="mt-0.5 truncate text-[11px] text-slate-400">
                {session.preview}
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setTaskMenuId((value) => value === session.sessionId ? null : session.sessionId);
              setDeletingTaskId(null);
              setProjectMenuId(null);
            }}
            className="mr-1 flex h-8 w-7 flex-none items-center justify-center self-center rounded-md text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-900 group-hover:opacity-100 focus:opacity-100"
            title="会话操作"
            aria-label={`管理会话 ${session.name}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {taskMenuId === session.sessionId && renamingTaskId !== session.sessionId && (
        <div className="absolute right-1 top-9 z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {deletingTaskId === session.sessionId ? (
            <div className="p-1.5">
              <div className="text-[11px] leading-4 text-red-700">删除后无法恢复，确认删除这个会话？</div>
              <div className="mt-2 flex justify-end gap-1">
                <button type="button" onClick={() => setDeletingTaskId(null)} className="h-7 rounded-md px-2 text-[11px] text-slate-600 hover:bg-slate-100">取消</button>
                <button type="button" disabled={taskActionBusy} onClick={() => void removeTask(session.sessionId)} className="h-7 rounded-md bg-red-600 px-2 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50">删除</button>
              </div>
            </div>
          ) : (
            <>
              {options.archived ? (
                <button type="button" onClick={() => { setSessionArchived(session.sessionId, false); setTaskMenuId(null); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100">
                  <ArchiveRestore className="h-3.5 w-3.5" />恢复会话
                </button>
              ) : (
                <button type="button" onClick={() => { toggleSessionPinned(session.sessionId); setTaskMenuId(null); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100">
                  {pinnedSessionIds[session.sessionId] ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  {pinnedSessionIds[session.sessionId] ? '取消置顶' : '置顶会话'}
                </button>
              )}
              <button type="button" onClick={() => { setTaskNameDraft(session.name); setRenamingTaskId(session.sessionId); setTaskMenuId(null); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100">
                <Pencil className="h-3.5 w-3.5" />重命名会话
              </button>
              {!options.archived && (
                <div className="my-1 border-y border-slate-100 py-1">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">移到</div>
                  <div className="max-h-36 overflow-y-auto">
                    {orderedProjects.map((project) => (
                      <button key={project.id} type="button" onClick={() => moveTaskToProject(session.sessionId, project.id)} className={cn('flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-slate-100', projectBySessionId[session.sessionId] === project.id ? 'text-blue-700' : 'text-slate-700')}>
                        <Folder className="h-3.5 w-3.5 flex-none" /><span className="truncate">{project.name}</span>
                      </button>
                    ))}
                    {projectBySessionId[session.sessionId] && (
                      <button type="button" onClick={() => { moveTaskToChat(session.sessionId); setTaskMenuId(null); if (session.sessionId === currentSessionId) closeSurface(); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100">
                        <MessageSquare className="h-3.5 w-3.5" />移到 Chat
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!options.archived && (
                <button type="button" onClick={() => void archiveTask(session.sessionId)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100">
                  <Archive className="h-3.5 w-3.5" />归档会话
                </button>
              )}
              <button type="button" onClick={() => setDeletingTaskId(session.sessionId)} className="mt-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-red-600 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />删除会话
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  const renderSessions = (title: string, items: typeof filteredSessions) => {
    if (items.length === 0) return null;
    return (
      <section className="mt-2">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {title}
        </div>
        <div className="mt-1 space-y-0.5">
          {items.map((session) => renderTaskButton(session))}
        </div>
      </section>
    );
  };

  return (
    <aside
      className="relative flex h-full flex-none flex-col border-r border-slate-200 bg-slate-50/95"
      style={{ width: sidebarWidth }}
    >
      <div
        className="absolute inset-y-0 right-0 z-[120] w-1.5 cursor-col-resize touch-none hover:bg-blue-500/20"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
        }}
        onPointerMove={(event) => {
          const drag = sidebarResizeRef.current;
          if (!drag) return;
          setSidebarWidth(drag.startWidth + event.clientX - drag.startX);
        }}
        onPointerUp={(event) => {
          sidebarResizeRef.current = null;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
        }}
        onPointerCancel={() => { sidebarResizeRef.current = null; }}
        aria-hidden="true"
      />
      <div className="h-8 flex-none" style={dragStyle} />
      <div className="flex items-center gap-2 px-4 pb-3" style={dragStyle}>
        <img src={publicAssetUrl('LogoText.svg')} alt="Tanva" className="h-6 w-auto" />
        <button
          type="button"
          onClick={toggleSidebar}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-900"
          style={noDragStyle}
          title="收起侧栏 (⌘B)"
          aria-label="收起侧栏"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3" style={noDragStyle}>
        <button
          type="button"
          onClick={() => void startTask()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          新任务
        </button>
        <label className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-transparent px-2.5 text-slate-500 transition-colors focus-within:border-slate-200 focus-within:bg-white hover:bg-white/70">
          <Search className="h-4 w-4 flex-none" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                if (query) setQuery('');
                else event.currentTarget.blur();
                return;
              }
              if (event.key === 'ArrowDown' && filteredSessions.length > 0) {
                event.preventDefault();
                setSearchActiveIndex((value) => (value + 1) % filteredSessions.length);
                return;
              }
              if (event.key === 'ArrowUp' && filteredSessions.length > 0) {
                event.preventDefault();
                setSearchActiveIndex((value) => (value - 1 + filteredSessions.length) % filteredSessions.length);
                return;
              }
              if (event.key === 'Enter' && filteredSessions[searchActiveIndex]) {
                event.preventDefault();
                void selectTask(filteredSessions[searchActiveIndex].sessionId);
                setQuery('');
              }
            }}
            placeholder="搜索任务"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          <span className="text-[10px] text-slate-400">⌘K</span>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" style={noDragStyle}>
        <section
          className="mt-4"
          onDragEnter={() => {
            if (useDesktopTaskContextStore.getState().workCollapsed) {
              toggleWorkCollapsed();
            }
          }}
        >
          <div className="flex h-7 items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <button
              type="button"
              onClick={toggleWorkCollapsed}
              className="-ml-1 flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left hover:bg-white hover:text-slate-900"
              title={workCollapsed ? '展开 Work' : '收起 Work'}
              aria-label={workCollapsed ? '展开 Work' : '收起 Work'}
              aria-expanded={!workCollapsed}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 flex-none text-slate-400 transition-transform', !workCollapsed && 'rotate-90')} />
              <BriefcaseBusiness className="h-3.5 w-3.5 flex-none" />
              <span className="min-w-0 flex-1">Work</span>
            </button>
            <button
              type="button"
              onClick={() => beginProjectCreation()}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-900"
              title="新建项目"
              aria-label="新建项目"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {!workCollapsed && creatingProject && (
            <form
              className="mx-1 mt-1 rounded-xl border border-blue-200 bg-white p-2 shadow-sm"
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                setCreatingProject(false);
                setProjectCreationSessionId(null);
                setNewProjectName('');
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void submitProjectCreation();
              }}
            >
              <div className="text-[10px] font-medium text-slate-500">
                {projectCreationSessionId ? '创建项目并移入当前任务' : '新建项目'}
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="项目名称"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-xs text-slate-900 outline-none focus:border-blue-500"
                  aria-label="项目名称"
                />
                <button
                  type="submit"
                  disabled={!newProjectName.trim() || projectActionBusy}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  title="创建项目"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingProject(false);
                    setProjectCreationSessionId(null);
                    setProjectActionError('');
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                  title="取消"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </form>
          )}
          {!workCollapsed && <div className="mt-1 space-y-1">
            {orderedProjects.map((project) => {
              const projectSessions = filteredSessions.filter(
                (session) => projectBySessionId[session.sessionId] === project.id
              );
              const isDropTarget = dragTarget === project.id;
              const isCollapsed = Boolean(collapsedProjectIds[project.id]);
              const isRenaming = renamingProjectId === project.id;
              const isDeleting = deletingProjectId === project.id;
              return (
                <div
                  key={project.id}
                  data-desktop-project-menu-root={project.id}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragTarget(project.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragTarget(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sessionId =
                      event.dataTransfer.getData('application/x-tanva-session') ||
                      event.dataTransfer.getData('text/plain');
                    if (sessionId) {
                      bindTaskProject(sessionId, project.id);
                      if (sessionId === currentSessionId) {
                        closeSurface();
                        openProject(project.id);
                      }
                    }
                    setDragTarget(null);
                  }}
                  className={cn(
                    'relative rounded-xl border border-transparent p-1 transition-colors',
                    isDropTarget && 'border-blue-300 bg-blue-50'
                  )}
                >
                  {isRenaming ? (
                    <form
                      className="flex h-9 items-center gap-1 rounded-lg bg-white px-1"
                      onBlur={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget)) return;
                        if (projectNameDraft.trim()) {
                          void submitProjectRename(project.id);
                        } else {
                          setRenamingProjectId(null);
                        }
                      }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitProjectRename(project.id);
                      }}
                    >
                      <input
                        autoFocus
                        value={projectNameDraft}
                        onChange={(event) => setProjectNameDraft(event.target.value)}
                        className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-500"
                        aria-label="项目名称"
                      />
                      <button type="submit" disabled={!projectNameDraft.trim() || projectActionBusy} className="flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 disabled:text-slate-300" title="保存">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setRenamingProjectId(null)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="取消">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <div className="group flex h-8 items-center rounded-lg hover:bg-white">
                      <button
                        type="button"
                        onClick={() => toggleProjectCollapsed(project.id)}
                        className={cn(
                          'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left text-xs font-medium text-slate-600 hover:text-slate-950',
                          currentProjectId === project.id && 'text-slate-950'
                        )}
                        title={isCollapsed ? '展开项目' : '收起项目'}
                        aria-label={`${isCollapsed ? '展开项目' : '收起项目'} ${project.name}`}
                        aria-expanded={!isCollapsed}
                      >
                        <ChevronRight className={cn('h-3.5 w-3.5 flex-none text-slate-400 transition-transform', !isCollapsed && 'rotate-90')} />
                        <Folder className="h-3.5 w-3.5 flex-none" />
                        {pinnedProjectIds[project.id] && (
                          <Pin className="h-3 w-3 flex-none text-slate-400" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        {projectSessions.length > 0 && (
                          <span className="text-[10px] font-normal text-slate-400">
                            {projectSessions.length}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void startProjectTask(project)}
                        disabled={creatingTaskProjectId !== null}
                        className="flex h-8 w-7 flex-none items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-wait disabled:opacity-40"
                        title={`在 ${project.name} 中发起新会话`}
                        aria-label={`在 ${project.name} 中发起新会话`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProjectMenuId((value) => value === project.id ? null : project.id);
                          setTaskMenuId(null);
                          setDeletingProjectId(null);
                          setProjectActionError('');
                        }}
                        className="flex h-8 w-7 flex-none items-center justify-center rounded-md text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-900 group-hover:opacity-100 focus:opacity-100"
                        title="管理项目"
                        aria-label={`管理项目 ${project.name}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {projectMenuId === project.id && !isRenaming && (
                    <div className="absolute right-1 top-9 z-40 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                      {isDeleting ? (
                        <div className="p-1.5">
                          <div className="text-[11px] leading-4 text-red-700">
                            删除项目后无法恢复，项目内任务会移回 Chat。
                          </div>
                          <div className="mt-2 flex justify-end gap-1">
                            <button type="button" onClick={() => setDeletingProjectId(null)} className="h-7 rounded-md px-2 text-[11px] text-slate-600 hover:bg-slate-100">取消</button>
                            <button type="button" disabled={projectActionBusy} onClick={() => void confirmProjectDeletion(project.id)} className="h-7 rounded-md bg-red-600 px-2 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50">删除</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              toggleProjectPinned(project.id);
                              setProjectMenuId(null);
                            }}
                            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100"
                          >
                            {pinnedProjectIds[project.id] ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                            {pinnedProjectIds[project.id] ? '取消置顶' : '置顶项目'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setProjectNameDraft(project.name);
                              setRenamingProjectId(project.id);
                              setProjectMenuId(null);
                            }}
                            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            重命名项目
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingProjectId(project.id)}
                            className="mt-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除项目
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {projectSessions.length > 0 && !isCollapsed && (
                    <div className="ml-3 space-y-0.5 border-l border-slate-200 pl-1.5">
                      {projectSessions.map((session) => renderTaskButton(session))}
                    </div>
                  )}
                </div>
              );
            })}
            {orderedProjects.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-slate-400">
                点击右侧 + 创建第一个项目
              </div>
            )}
            {projectActionError && (
              <div className="mx-1 rounded-lg bg-red-50 px-2 py-1.5 text-[10px] leading-4 text-red-700">
                {projectActionError}
              </div>
            )}
          </div>}
        </section>

        <section
          className={cn(
            'mt-4 rounded-xl border border-transparent p-1 transition-colors',
            dragTarget === 'chat' && 'border-blue-300 bg-blue-50'
          )}
          onDragEnter={(event) => {
            event.preventDefault();
            if (useDesktopTaskContextStore.getState().chatCollapsed) {
              toggleChatCollapsed();
            }
            setDragTarget('chat');
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragTarget(null);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            const sessionId =
              event.dataTransfer.getData('application/x-tanva-session') ||
              event.dataTransfer.getData('text/plain');
            if (sessionId) {
              moveTaskToChat(sessionId);
              if (sessionId === currentSessionId) closeSurface();
            }
            setDragTarget(null);
          }}
        >
          <button
            type="button"
            onClick={toggleChatCollapsed}
            className="flex h-7 w-full items-center gap-1.5 rounded-lg px-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-white hover:text-slate-900"
            title={chatCollapsed ? '展开 Chat' : '收起 Chat'}
            aria-label={chatCollapsed ? '展开 Chat' : '收起 Chat'}
            aria-expanded={!chatCollapsed}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 flex-none text-slate-400 transition-transform', !chatCollapsed && 'rotate-90')} />
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Chat</span>
          </button>
          {!chatCollapsed && (
            <>
              {renderSessions('今天', todaySessions)}
              {renderSessions('最近', recentSessions)}
              {chatSessions.length === 0 && (
                <div className="px-3 py-3 text-[11px] text-slate-400">
                  拖到这里可解除项目绑定
                </div>
              )}
            </>
          )}
        </section>
        {archivedSessions.length > 0 && (
          <details className="mt-2 rounded-xl p-1 text-slate-500">
            <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-white hover:text-slate-900">
              <Archive className="h-3.5 w-3.5" />
              已归档
              <span className="ml-auto text-[10px] font-normal text-slate-400">{archivedSessions.length}</span>
            </summary>
            <div className="mt-1 space-y-0.5">
              {archivedSessions.map((session) => renderTaskButton(session, { archived: true }))}
            </div>
          </details>
        )}
        {filteredSessions.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-slate-400">
            {query ? '没有匹配的任务' : '新任务会显示在这里'}
          </div>
        )}
      </div>

      <div className="relative border-t border-slate-200 p-3" style={noDragStyle}>
        {showExtensions && (
          <div data-desktop-extensions-root className="absolute bottom-[104px] left-3 right-3 z-50 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            <div className="px-2 py-1 text-[11px] font-semibold text-slate-500">已安装工具面</div>
            <div className="mt-1 space-y-1">
              {plugins.map((plugin) => {
                return (
                  <div
                    key={plugin.manifest.id}
                    className="flex w-full items-start gap-2 rounded-lg p-2 text-left"
                  >
                    <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <Puzzle className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-xs font-semibold text-slate-900">
                        {plugin.manifest.name}
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
                          已启用
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-500">
                        {plugin.manifest.description}
                      </span>
                    </span>
                    {plugin.manifest.activation?.userOpenable && (
                      <button
                        type="button"
                        onClick={() => {
                          openSurface(plugin.manifest.id, 'docked');
                          setShowExtensions(false);
                        }}
                        className="mt-0.5 flex-none rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-950"
                      >
                        管理
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showAccount && (
          <div data-desktop-account-root className="absolute bottom-[64px] left-3 right-3 z-50 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            <div className="px-2 py-2">
              <div className="truncate text-xs font-semibold text-slate-900">
                {user?.name || 'Tanva 用户'}
              </div>
              {user?.email && (
                <div className="mt-0.5 truncate text-[11px] text-slate-500">{user.email}</div>
              )}
            </div>
            <div className="mb-1 border-y border-slate-100 py-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                账号与团队
              </div>
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => void switchTeam(team.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-100',
                    team.id === activeTeamId && 'bg-blue-50'
                  )}
                >
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    {team.isPersonal ? (
                      <span className="text-[10px] font-semibold">
                        {(user?.name || 'T').slice(0, 1).toUpperCase()}
                      </span>
                    ) : (
                      <Users className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-700">
                      {team.isPersonal ? '个人空间' : team.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                      <Coins className="h-3 w-3" />
                      {(team.isPersonal ? personalCredits : team.availableCredits)?.toLocaleString() ?? '--'}
                    </span>
                  </span>
                  {team.id === activeTeamId && (
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            >
              <LogOut className="h-3.5 w-3.5" />
              退出登录
            </button>
          </div>
        )}

        <button
          data-desktop-extensions-root
          type="button"
          onClick={() => {
            setShowExtensions((value) => !value);
            setShowAccount(false);
          }}
          className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-slate-600 hover:bg-white hover:text-slate-950"
        >
          <Puzzle className="h-4 w-4" />
          <span className="flex-1 text-left">扩展</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showExtensions && 'rotate-180')} />
        </button>
        <button
          data-desktop-account-root
          type="button"
          onClick={() => {
            setShowAccount((value) => !value);
            setShowExtensions(false);
          }}
          className="mt-1 flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-slate-600 hover:bg-white hover:text-slate-950"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
            {(user?.name || user?.email || 'T').slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs">
            <span className="block truncate">
              {activeTeam?.isPersonal
                ? user?.name || user?.email || '个人空间'
                : activeTeam?.name || user?.name || 'Tanva 用户'}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
              <Coins className="h-3 w-3" />
              {displayedCredits?.toLocaleString() ?? '--'}
            </span>
          </span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAccount && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
