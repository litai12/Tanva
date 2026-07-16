import { useEffect, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { projectApi } from '@/services/projectApi';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useLayerStore } from '@/stores/layerStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectAutosave } from '@/hooks/useProjectAutosave';
import { paperSaveService } from '@/services/paperSaveService';
import { saveMonitor } from '@/utils/saveMonitor';
import { useProjectStore } from '@/stores/projectStore';
import { contextManager } from '@/services/contextManager';
import { useAIChatStore } from '@/stores/aiChatStore';
import { getProjectCache, setProjectCache, isCacheValid, isCacheFresh } from '@/services/projectCacheStore';
import { getPendingUploadSummary } from '@/utils/pendingUploadSummary';
import { consumeBeforeUnloadPromptSkip } from '@/utils/beforeUnloadGuard';
import { createEmptyProjectContent, type ProjectContentSnapshot } from '@/types/project';
import { projectLoadDebug, waitForProjectLoadPaint } from '@/utils/projectLoadDebug';
import { useAuthStore } from '@/stores/authStore';
import { collabCanvasBridge } from '@/collab/collabCanvasBridge';
import { projectVersionChannel } from '@/services/projectVersionChannel';

const CANVAS_VIEW_SYNC_DELAY_MS = 160;

type ProjectAutosaveManagerProps = {
  projectId: string | null;
};

declare global {
  interface Window {
    tanvaImageInstances?: unknown[];
    tanvaModel3DInstances?: unknown[];
    tanvaTextItems?: unknown[];
    tanvaPaperRestored?: boolean;
  }
}

const clearRuntimeProjectInstances = () => {
  try { window.tanvaImageInstances = []; } catch {}
  try { window.tanvaModel3DInstances = []; } catch {}
  try { window.tanvaTextItems = []; } catch {}
};

const clearProjectRuntime = (projectId: string, phase = 'Paper clear previous project') => {
  return projectLoadDebug.measureSync(projectId, phase, () => {
    let clearedPaper = false;
    try { clearedPaper = paperSaveService.clearProject(); } catch {}
    clearRuntimeProjectInstances();
    return clearedPaper;
  });
};

const setRuntimePaperRestored = (restored: boolean) => {
  try { window.tanvaPaperRestored = restored; } catch {}
};

/**
 * 版本冲突并集合并后的 adopt：把合并后的快照重载进**运行时**（画布 + 各 store）。
 * 既让当前用户立刻看到并集结果，也保证后续保存基于完整并集，不会用本地内容把刚并进来的
 * 远端新增又覆盖丢掉。仅在非活跃实时协作（长连接未连）时调用——活跃协作下运行时已由
 * node_patch/canvas_patch 收敛，重载只会无谓打断会话。
 */
const reconcileMergedRuntime = (
  projectId: string,
  content: ProjectContentSnapshot,
  version: number,
  updatedAt: string | null,
) => {
  try {
    // 1) 同步内容 store 基线（不重置 projectViewReady，避免触发整页加载态闪烁）
    useProjectContentStore.getState().hydrate(content, version, updatedAt, {
      preserveProjectViewReady: true,
    });
    // 2) AI 会话
    try {
      const chatStore = useAIChatStore.getState();
      const sessions = content?.aiChatSessions ?? [];
      if (sessions.length > 0) {
        chatStore.hydratePersistedSessions(sessions, content?.aiChatActiveSessionId ?? null, {
          markProjectDirty: false,
        });
      }
    } catch {}
    // 3) 画布：清空后重新 importJSON 合并后的 paperJson
    if (content?.paperJson) {
      const paperJson = content.paperJson;
      const doImport = () => {
        clearProjectRuntime(projectId, 'Paper clear before merged adopt');
        const ok = paperSaveService.deserializePaperProject(paperJson, { skipProjectClear: true });
        if (ok) setRuntimePaperRestored(true);
        return ok;
      };
      if (!doImport()) {
        // paper 尚未就绪，等一次 paper-ready 再试，并设超时兜底
        const handler = () => {
          if (doImport()) window.removeEventListener('paper-ready', handler as EventListener);
        };
        window.addEventListener('paper-ready', handler as EventListener);
        setTimeout(() => {
          window.removeEventListener('paper-ready', handler as EventListener);
          doImport();
        }, 500);
      }
    }
    // 4) 图层
    try {
      useLayerStore.getState().hydrateFromContent(content.layers || [], content.activeLayerId ?? null);
    } catch {}
    saveMonitor.push(projectId, 'merged_runtime_reconciled', { version });
  } catch (err) {
    console.warn('reconcile merged runtime failed:', err);
  }
};

const sameCanvasSnapshot = (
  prev: { zoom: number; panX: number; panY: number } | null | undefined,
  next: { zoom: number; panX: number; panY: number } | null | undefined
) =>
  prev === next ||
  (
    !!prev &&
    !!next &&
    prev.zoom === next.zoom &&
    prev.panX === next.panX &&
    prev.panY === next.panY
  );

const summarizeProjectContentForLoadDebug = (content: ProjectContentSnapshot | null | undefined) => {
  const flowNodes = Array.isArray(content?.flow?.nodes) ? content.flow.nodes : [];
  const flowEdges = Array.isArray(content?.flow?.edges) ? content.flow.edges : [];
  const layers = Array.isArray(content?.layers) ? content.layers : [];
  const nodeTypes = flowNodes.reduce<Record<string, number>>((acc, node) => {
    const type = typeof node?.type === 'string' && node.type.trim() ? node.type.trim() : 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return {
    flowNodes: flowNodes.length,
    flowEdges: flowEdges.length,
    nodeTypes,
    layers: layers.length,
    paperJsonLen: typeof content?.paperJson === 'string' ? content.paperJson.length : 0,
    assetImages: Array.isArray(content?.assets?.images) ? content.assets.images.length : 0,
    assetModels: Array.isArray(content?.assets?.models) ? content.assets.models.length : 0,
    assetTexts: Array.isArray(content?.assets?.texts) ? content.assets.texts.length : 0,
    assetVideos: Array.isArray(content?.assets?.videos) ? content.assets.videos.length : 0,
    aiChatSessions: Array.isArray(content?.aiChatSessions) ? content.aiChatSessions.length : 0,
  };
};

export default function ProjectAutosaveManager({ projectId }: ProjectAutosaveManagerProps) {
  const setProject = useProjectContentStore((state) => state.setProject);
  const hydrate = useProjectContentStore((state) => state.hydrate);
  const setError = useProjectContentStore((state) => state.setError);
  const setWarning = useProjectContentStore((state) => state.setWarning);
  const setCacheValidationPending = useProjectContentStore((state) => state.setCacheValidationPending);
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const hydrationReadyRef = useRef(false);

  useEffect(() => {
    if (!projectId) {
      paperSaveService.cancelPending();
      setCacheValidationPending(false);
      if (useProjectContentStore.getState().projectId !== null) {
        setProject(null);
      }
      try { useAIChatStore.getState().resetSessions(); } catch {}
      try { contextManager.clearImageCache(); } catch {}
      // 不再清空图片历史，保留跨文件的历史记录
      // try { useImageHistoryStore.getState().clearHistory(); } catch {}
      // 清空画布与运行时实例
      try { paperSaveService.clearProject(); } catch {}
      clearRuntimeProjectInstances();
      return undefined;
    }

    let cancelled = false;
    projectLoadDebug.start(projectId, { source: 'ProjectAutosaveManager' });
    hydrationReadyRef.current = false;
    paperSaveService.cancelPending();
    // 切换项目时清理跨项目的缓存/历史，避免“隐藏图片信息继承”
    try { contextManager.clearImageCache(); } catch {}
    // 不再清空图片历史，避免切换文件导致历史丢失
    // try { useImageHistoryStore.getState().clearHistory(); } catch {}
    if (useProjectContentStore.getState().projectId !== projectId) {
      projectLoadDebug.measureSync(projectId, 'content store setProject', () => {
        setProject(projectId);
      });
    }
    try { useAIChatStore.getState().resetSessions(); } catch {}
    projectLoadDebug.mark(projectId, 'runtime cleanup done');

    (async () => {
      try {
        await waitForProjectLoadPaint();
        if (cancelled) return;
        // 清空旧项目内容放到下一帧执行，避免点击切换时同步阻塞菜单/标题刷新。
        let paperAlreadyClearedForImport = clearProjectRuntime(projectId);

        type LoadedProjectContent = { content: ProjectContentSnapshot; version: number; updatedAt: string | null };
        type ProjectMeta = ReturnType<typeof useProjectStore.getState>['projects'][number];

        const findProjectMetaInStore = (): ProjectMeta | null => {
          const state = useProjectStore.getState();
          if (state.currentProject?.id === projectId) return state.currentProject;
          return state.projects.find((p) => p.id === projectId) ?? null;
        };

        const resolveProjectMeta = async (): Promise<ProjectMeta | null> => {
          const local = findProjectMetaInStore();
          if (local) return local;
          return projectApi.get(projectId);
        };

        const applyLoadedProjectContent = async (
          data: LoadedProjectContent,
          options: { source: 'cache' | 'cloud'; replaceExistingPaper?: boolean }
        ) => {
          if (cancelled) return null;
          if (options.replaceExistingPaper) {
            await waitForProjectLoadPaint();
            if (cancelled) return null;
            paperAlreadyClearedForImport = clearProjectRuntime(projectId, 'Paper clear before content replace');
          }

          const contentSummary = summarizeProjectContentForLoadDebug(data.content);
          projectLoadDebug.mark(projectId, `${options.source} content ready`, {
            version: data.version,
            updatedAt: data.updatedAt,
            ...contentSummary,
          });

          projectLoadDebug.measureSync(projectId, 'content store hydrate', () => {
            hydrate(data.content, data.version, data.updatedAt ?? null);
          }, contentSummary);
          projectLoadDebug.measureSync(projectId, 'AI chat hydrate', () => {
            try {
              const chatStore = useAIChatStore.getState();
              const sessions = data.content?.aiChatSessions ?? [];
              const activeSessionId = data.content?.aiChatActiveSessionId ?? null;
              if (sessions.length > 0) {
                chatStore.hydratePersistedSessions(sessions, activeSessionId, { markProjectDirty: false });
              } else {
                chatStore.resetSessions();
              }
            } catch (error) {
              console.error('❌ 同步聊天会话失败:', error);
            }
          }, {
            aiChatSessions: contentSummary.aiChatSessions,
          });
          // 任意一次成功的 hydrate 都清空跨文件缓存，避免“图片缓存继承”
          try { contextManager.clearImageCache(); } catch {}
          // 保留图片历史，便于跨文件查看
          // try { useImageHistoryStore.getState().clearHistory(); } catch {}
          saveMonitor.push(projectId, 'hydrate_loaded', {
            version: data.version,
            source: options.source,
            hasPaper: !!data.content.paperJson,
            paperJsonLen: data.content.meta?.paperJsonLen || data.content.paperJson?.length || 0,
            layers: data.content.layers?.length || 0,
          });

          await waitForProjectLoadPaint();
          if (cancelled) return null;

          // 恢复Paper.js绘制内容（等待 Paper 初始化）
          if (data.content?.paperJson) {
            const paperJson = data.content.paperJson;
            const attempt = async () => {
              const skipProjectClear = paperAlreadyClearedForImport;
              paperAlreadyClearedForImport = false;
              const ok = projectLoadDebug.measureSync(projectId, 'Paper deserialize attempt', () => (
                paperSaveService.deserializePaperProject(paperJson, { skipProjectClear })
              ), {
                paperJsonLen: contentSummary.paperJsonLen,
                source: options.source,
                skipProjectClear,
              });
              if (ok) {
                console.log('✅ Paper.js绘制内容恢复成功');
                saveMonitor.push(projectId, 'hydrate_success', {
                  source: options.source,
                  paperJsonLen: paperJson.length,
                });
                setRuntimePaperRestored(true);
              }
              return ok;
            };

            // 先尝试一次
            const restored = await attempt();

            if (!restored) {
              // 监听全局 paper-ready 事件再试
              await new Promise<void>((resolve) => {
                const handler = async () => {
                  const ok = await attempt();
                  if (ok) {
                    window.removeEventListener('paper-ready', handler as EventListener);
                    resolve();
                  }
                };
                window.addEventListener('paper-ready', handler as EventListener);
                // 超时兜底
                setTimeout(() => {
                  window.removeEventListener('paper-ready', handler as EventListener);
                  attempt().then(() => resolve());
                }, 500);
              });
            }
          } else {
            projectLoadDebug.mark(projectId, 'Paper deserialize skipped', {
              source: options.source,
              paperJsonLen: 0,
            });
          }

          // 同步层级与活动层到层store（无论是否有paperJson，都以内容为准刷新UI）
          projectLoadDebug.measureSync(projectId, 'layer store hydrate', () => {
            try {
              useLayerStore.getState().hydrateFromContent(
                data.content.layers || [],
                data.content.activeLayerId ?? null,
              );
              // 用后端项目信息刷新 header 显示（避免列表尚未包含该项目时显示空/旧名）
              try { useProjectStore.getState().open(projectId); } catch {}
            } catch {}
          }, {
            layers: contentSummary.layers,
            source: options.source,
          });

          hydrationReadyRef.current = true;
          return contentSummary;
        };

        const cached = userId
          ? await projectLoadDebug.measure(
              projectId,
              'IndexedDB cache read',
              () => getProjectCache(projectId, { userId })
            )
          : null;

        let appliedCache = false;
        let cacheDirtyCounter = 0;
        let cacheSummary: ReturnType<typeof summarizeProjectContentForLoadDebug> | null = null;

        if (cached && isCacheFresh(cached)) {
          console.log('[ProjectCache] 本地缓存命中，先恢复画布并后台校验远端版本');
          projectLoadDebug.mark(projectId, 'cache stale-while-revalidate hit', {
            cacheVersion: cached.version,
            cacheUpdatedAt: cached.updatedAt,
          });
          setCacheValidationPending(true);
          cacheSummary = await applyLoadedProjectContent(
            { content: cached.content, version: cached.version, updatedAt: cached.updatedAt },
            { source: 'cache' }
          );
          if (cancelled) return;
          appliedCache = !!cacheSummary;
          cacheDirtyCounter = useProjectContentStore.getState().dirtyCounter;
        } else {
          setCacheValidationPending(false);
          projectLoadDebug.mark(projectId, 'cache unavailable for immediate hydrate', {
            hasCached: !!cached,
            cacheVersion: cached?.version,
          });
        }

        let shouldFetchContent = !appliedCache;
        let projectMeta: ProjectMeta | null = null;

        if (appliedCache && cached) {
          try {
            projectMeta = await projectLoadDebug.measure(
              projectId,
              'meta validate',
              () => resolveProjectMeta()
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            projectLoadDebug.mark(projectId, 'meta validate failed', { message: msg });
            if (typeof msg === 'string' && msg.includes('项目不存在')) {
              throw error;
            }
            setWarning('已从本地缓存打开项目；远端版本校验失败，后续保存将按网络状态重试。');
            setCacheValidationPending(false);
            projectLoadDebug.end(projectId, {
              version: cached.version,
              source: 'cache',
              validation: 'failed',
              ...(cacheSummary ?? {}),
            });
            return;
          }

          projectLoadDebug.mark(projectId, 'meta resolved', {
            hasProjectMeta: !!projectMeta,
            metaVersion: projectMeta?.contentVersion,
            metaUpdatedAt: projectMeta?.updatedAt,
          });

          const cacheValid = !!(projectMeta && isCacheValid(cached, {
            contentVersion: projectMeta.contentVersion,
            updatedAt: projectMeta.updatedAt,
          }));

          if (cacheValid) {
            console.log('[ProjectCache] 本地缓存版本已通过远端校验');
            projectLoadDebug.mark(projectId, 'cache validated', {
              cacheVersion: cached.version,
              metaVersion: projectMeta?.contentVersion,
            });
            setCacheValidationPending(false);
            projectLoadDebug.end(projectId, {
              version: cached.version,
              source: 'cache',
              validation: 'valid',
              ...(cacheSummary ?? {}),
            });
            return;
          }

          shouldFetchContent = true;
          projectLoadDebug.mark(projectId, 'cache stale, fetching cloud content', {
            cacheVersion: cached.version,
            metaVersion: projectMeta?.contentVersion,
          });
        }

        if (!shouldFetchContent) return;

        const data = await projectLoadDebug.measure(
          projectId,
          'getContent request',
          () => projectApi.getContent(projectId)
        );

        if (data.content && !cancelled) {
          projectLoadDebug.mark(projectId, 'IndexedDB cache write scheduled', {
            version: data.version,
            updatedAt: data.updatedAt,
          });
          setProjectCache({
            projectId,
            userId,
            content: data.content,
            version: data.version,
            updatedAt: data.updatedAt ?? new Date().toISOString(),
            cachedAt: new Date().toISOString(),
          }).catch(() => {});
        }

        if (cancelled) return;

        if (appliedCache && cached) {
          const store = useProjectContentStore.getState();
          const hasLocalChangesAfterCache =
            store.projectId === projectId &&
            (store.dirty || store.dirtyCounter > cacheDirtyCounter);
          if (hasLocalChangesAfterCache && data.version > cached.version) {
            setWarning('远端项目已有更新，且你已基于本地缓存做了修改；为避免覆盖远端版本，自动保存已暂停。请重新打开项目加载最新版本后再修改。');
            setCacheValidationPending(true);
            useProjectContentStore.getState().setStaleContent(true, 'remote-newer');
            projectLoadDebug.end(projectId, {
              version: cached.version,
              source: 'cache',
              validation: 'conflict',
              remoteVersion: data.version,
              ...(cacheSummary ?? {}),
            });
            return;
          }
        }

        const contentSummary = await applyLoadedProjectContent(
          data,
          { source: 'cloud', replaceExistingPaper: appliedCache }
        );
        setCacheValidationPending(false);
        projectLoadDebug.end(projectId, {
          version: data.version,
          source: 'cloud',
          ...(contentSummary ?? {}),
        });
      } catch (err) {
        if (cancelled) return;
        setCacheValidationPending(false);
        const errorMessage = err instanceof Error ? err.message : String(err);
        projectLoadDebug.mark(projectId, 'project load error', {
          message: errorMessage,
        });
        // 不再用空内容覆盖当前画布，避免“闪一下又消失”
        const msg = errorMessage || '加载项目内容失败';
        setError(msg);

        const isProjectNotFound = typeof msg === 'string' && msg.includes('项目不存在');

        // 云端加载失败时，尝试回退到最近一次本地良好快照（仅恢复 paperJson）
        if (!isProjectNotFound) {
          const restored = (() => {
            try {
              const raw = localStorage.getItem(`tanva_last_good_snapshot_${projectId}`);
              if (!raw) return false;
              const parsed = JSON.parse(raw) as {
                version?: number;
                updatedAt?: string | null;
                paperJson?: string;
              };
              const paperJson = typeof parsed?.paperJson === 'string' ? parsed.paperJson.trim() : '';
              if (!paperJson) return false;

              const state = useProjectContentStore.getState();
              const baseContent = state.content ?? createEmptyProjectContent();
              const restoredUpdatedAt =
                typeof parsed?.updatedAt === 'string' && parsed.updatedAt
                  ? parsed.updatedAt
                  : new Date().toISOString();
              const restoredVersion =
                Number.isFinite(parsed?.version) && Number(parsed.version) > 0
                  ? Number(parsed.version)
                  : Math.max(1, state.version || 1);

              hydrate(
                {
                  ...baseContent,
                  paperJson,
                  meta: {
                    ...(baseContent.meta || {}),
                    paperJsonLen: paperJson.length,
                  },
                  updatedAt: restoredUpdatedAt,
                } as ProjectContentSnapshot,
                restoredVersion,
                restoredUpdatedAt
              );

              const ok = paperSaveService.deserializePaperProject(paperJson);
              if (!ok) return false;

              setRuntimePaperRestored(true);
              try {
                useProjectContentStore.getState().setWarning('云端加载失败，已从本地快照恢复画布内容（可能不是最新）');
              } catch {}
              setError(null);
              return true;
            } catch {
              return false;
            }
          })();

          if (restored) {
            hydrationReadyRef.current = true;
            return;
          }
        }

        // 若后端提示项目不存在，做容错处理：
        // - 清理无效的 projectId URL 参数
        // - 重置当前项目内容状态，避免后续保存报错
        // - 打开项目管理器并刷新项目列表，便于用户重新选择
        if (isProjectNotFound) {
          try {
            // 清理 URL 查询参数中的无效 projectId
            const url = new URL(window.location.href);
            if (url.searchParams.has('projectId')) {
              url.searchParams.delete('projectId');
              window.history.replaceState({}, '', `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}${url.hash}`);
            }
          } catch {}
          try {
            // 清理本地最近项目记录（若为无效ID）
            localStorage.removeItem('current_project_id');
          } catch {}
          try {
            // 重置内容态，防止后续自动保存继续以无效ID工作
            setProject(null);
          } catch {}
          try {
            // 打开管理器并刷新列表
            const store = useProjectStore.getState();
            store.openModal();
            store.load().catch(() => {});
          } catch {}
        }
        hydrationReadyRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
      hydrationReadyRef.current = false;
      setRuntimePaperRestored(false);
    };
  }, [projectId, setProject, hydrate, setError, setWarning, setCacheValidationPending, userId]);

  useEffect(() => {
    if (!projectId) return undefined;

    type LayerSnapshot = { layers: ReturnType<typeof useLayerStore.getState>['layers']; activeLayerId: string | null };
    type CanvasSnapshot = { zoom: number; panX: number; panY: number };
    let pendingCanvasSnapshot: CanvasSnapshot | null = null;
    let canvasSyncTimer: number | null = null;
    let lastSyncedCanvasSnapshot: CanvasSnapshot | null = null;

    const syncLayers = (snapshot?: LayerSnapshot) => {
      const layerState: LayerSnapshot = snapshot ?? {
        layers: useLayerStore.getState().layers,
        activeLayerId: useLayerStore.getState().activeLayerId ?? null,
      };
      const store = useProjectContentStore.getState();
      const markDirty = hydrationReadyRef.current && store.hydrated;
      store.updatePartial({
        layers: layerState.layers,
        activeLayerId: layerState.activeLayerId,
      }, { markDirty });
    };

    const syncCanvas = (snapshot?: CanvasSnapshot) => {
      const canvasState: CanvasSnapshot = snapshot ?? {
        zoom: useCanvasStore.getState().zoom,
        panX: useCanvasStore.getState().panX,
        panY: useCanvasStore.getState().panY,
      };
      const store = useProjectContentStore.getState();
      if (
        sameCanvasSnapshot(store.content?.canvas, canvasState) ||
        sameCanvasSnapshot(lastSyncedCanvasSnapshot, canvasState)
      ) {
        lastSyncedCanvasSnapshot = canvasState;
        return;
      }
      // 画布视角变化不标记 dirty，避免频繁触发自动保存
      store.updatePartial({
        canvas: {
          zoom: canvasState.zoom,
          panX: canvasState.panX,
          panY: canvasState.panY,
        },
      }, { markDirty: false });
      lastSyncedCanvasSnapshot = canvasState;
    };

    const scheduleCanvasSync = (snapshot: CanvasSnapshot) => {
      pendingCanvasSnapshot = snapshot;
      if (canvasSyncTimer !== null) {
        window.clearTimeout(canvasSyncTimer);
      }
      canvasSyncTimer = window.setTimeout(() => {
        canvasSyncTimer = null;
        const nextSnapshot = pendingCanvasSnapshot;
        pendingCanvasSnapshot = null;
        if (!nextSnapshot) return;
        syncCanvas(nextSnapshot);
      }, CANVAS_VIEW_SYNC_DELAY_MS);
    };

    syncLayers();
    syncCanvas();

    const unsubLayers = useLayerStore.subscribe(
      (state) => ({ layers: state.layers, activeLayerId: state.activeLayerId ?? null }),
      (next) => syncLayers(next),
      { equalityFn: shallow },
    );

    const unsubCanvas = useCanvasStore.subscribe(
      (state) => ({ zoom: state.zoom, panX: state.panX, panY: state.panY }),
      (next) => scheduleCanvasSync(next),
      { equalityFn: shallow },
    );

    return () => {
      if (canvasSyncTimer !== null) {
        window.clearTimeout(canvasSyncTimer);
      }
      unsubLayers();
      unsubCanvas();
    };
  }, [projectId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (consumeBeforeUnloadPromptSkip()) return;
      const { dirty } = useProjectContentStore.getState();
      const pending = getPendingUploadSummary();
      if (!dirty && !pending.hasRisk) return;
      event.preventDefault();
       
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // 版本冲突并集合并后的 adopt：保存命中冲突时 useProjectAutosave 派发本事件，携带合并后的快照。
  // 仅在非活跃实时协作（长连接未连）时把并集重载进运行时；活跃协作下运行时已由实时 patch 收敛。
  useEffect(() => {
    if (!projectId) return undefined;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        projectId?: string;
        content?: ProjectContentSnapshot;
        version?: number;
        updatedAt?: string | null;
      } | undefined;
      if (!detail?.content || detail.projectId !== projectId) return;
      // 活跃实时协作（长连接）下，运行时已由 node_patch/canvas_patch 收敛，重载只会打断会话。
      if (collabCanvasBridge.connected) return;
      const store = useProjectContentStore.getState();
      if (store.dirty || store.saving) {
        // 保存往返期间用户又有改动：重载会冲掉其在编内容。改为把基线版本退回到合并版本之前，
        // 迫使下一次自动保存再次命中冲突、由服务端重新并集（远端新增永不丢），待空闲时再展示。
        const target = (detail.version ?? store.version) - 1;
        if (target >= 0 && target < store.version) {
          useProjectContentStore.setState({ version: target });
        }
        return;
      }
      reconcileMergedRuntime(
        projectId,
        detail.content,
        detail.version ?? store.version,
        detail.updatedAt ?? null,
      );
    };
    window.addEventListener('tanva:adopt-merged-content', handler as EventListener);
    return () => window.removeEventListener('tanva:adopt-merged-content', handler as EventListener);
  }, [projectId]);

  // 同浏览器另一个 tab 保存推进版本后，落后的本 tab 即时冻结并强制刷新。
  // 活跃实时协作（长连接）下运行时由 patch 收敛、不算落后，跳过。
  useEffect(() => {
    if (!projectId) return undefined;
    return projectVersionChannel.onRemoteSaved(({ projectId: pid, version }) => {
      if (collabCanvasBridge.connected) return;
      const store = useProjectContentStore.getState();
      if (store.projectId === pid && version > store.version) {
        store.setStaleContent(true, 'other-tab');
      }
    });
  }, [projectId]);

  useProjectAutosave(projectId);

  return null;
}
