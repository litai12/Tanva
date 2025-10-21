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
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { useAIChatStore } from '@/stores/aiChatStore';

type ProjectAutosaveManagerProps = {
  projectId: string | null;
};

export default function ProjectAutosaveManager({ projectId }: ProjectAutosaveManagerProps) {
  const setProject = useProjectContentStore((state) => state.setProject);
  const hydrate = useProjectContentStore((state) => state.hydrate);
  const setError = useProjectContentStore((state) => state.setError);
  const dirty = useProjectContentStore((state) => state.dirty);

  const hydrationReadyRef = useRef(false);

  useEffect(() => {
    if (!projectId) {
      paperSaveService.cancelPending();
      if (useProjectContentStore.getState().projectId !== null) {
        setProject(null);
      }
      try { useAIChatStore.getState().resetSessions(); } catch {}
      try { contextManager.clearImageCache(); } catch {}
      // 不再清空图片历史，保留跨文件的历史记录
      // try { useImageHistoryStore.getState().clearHistory(); } catch {}
      // 清空画布与运行时实例
      try { paperSaveService.clearProject(); } catch {}
      try { (window as any).tanvaImageInstances = []; } catch {}
      try { (window as any).tanvaModel3DInstances = []; } catch {}
      try { (window as any).tanvaTextItems = []; } catch {}
      return undefined;
    }

    let cancelled = false;
    hydrationReadyRef.current = false;
    paperSaveService.cancelPending();
    // 切换项目时清理跨项目的缓存/历史，避免“隐藏图片信息继承”
    try { contextManager.clearImageCache(); } catch {}
    // 不再清空图片历史，避免切换文件导致历史丢失
    // try { useImageHistoryStore.getState().clearHistory(); } catch {}
    // 立即清空当前画布，避免在新建空项目时残留旧图像
    try { paperSaveService.clearProject(); } catch {}
    try { (window as any).tanvaImageInstances = []; } catch {}
    try { (window as any).tanvaModel3DInstances = []; } catch {}
    try { (window as any).tanvaTextItems = []; } catch {}
    if (useProjectContentStore.getState().projectId !== projectId) {
      setProject(projectId);
    }
    try { useAIChatStore.getState().resetSessions(); } catch {}

    (async () => {
      try {
        const data = await projectApi.getContent(projectId);
        if (cancelled) return;

        hydrate(data.content, data.version, data.updatedAt ?? null);
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
        // 任意一次成功的 hydrate 都清空跨文件缓存，避免“图片缓存继承”
        try { contextManager.clearImageCache(); } catch {}
        // 保留图片历史，便于跨文件查看
        // try { useImageHistoryStore.getState().clearHistory(); } catch {}
        saveMonitor.push(projectId, 'hydrate_loaded', {
          version: data.version,
          hasPaper: !!(data.content as any)?.paperJson,
          paperJsonLen: (data.content as any)?.meta?.paperJsonLen || (data.content as any)?.paperJson?.length || 0,
          layers: (data.content as any)?.layers?.length || 0,
        });

        // 恢复Paper.js绘制内容（等待 Paper 初始化）
        if (data.content?.paperJson) {
          const attempt = async () => {
            const ok = paperSaveService.deserializePaperProject(data.content!.paperJson!);
            if (ok) {
              console.log('✅ Paper.js绘制内容恢复成功');
              saveMonitor.push(projectId, 'hydrate_success', {
                paperJsonLen: (data.content as any)?.paperJson?.length || 0,
              });
              try { (window as any).tanvaPaperRestored = true; } catch {}
            }
            return ok;
          };

          // 先尝试一次
          let restored = await attempt();
          
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
        }

        // 同步层级与活动层到层store（无论是否有paperJson，都以内容为准刷新UI）
        try {
          useLayerStore.getState().hydrateFromContent(
            (data.content as any).layers || [],
            (data.content as any).activeLayerId ?? null,
          );
          // 用后端项目信息刷新 header 显示（避免列表尚未包含该项目时显示空/旧名）
          try { useProjectStore.getState().open(projectId); } catch {}
        } catch {}

        hydrationReadyRef.current = true;
      } catch (err: any) {
        if (cancelled) return;
        // 不再用空内容覆盖当前画布，避免“闪一下又消失”
        const msg = err?.message || '加载项目内容失败';
        setError(msg);

        // 若后端提示项目不存在，做容错处理：
        // - 清理无效的 projectId URL 参数
        // - 重置当前项目内容状态，避免后续保存报错
        // - 打开项目管理器并刷新项目列表，便于用户重新选择
        if (typeof msg === 'string' && msg.includes('项目不存在')) {
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
      try { (window as any).tanvaPaperRestored = false; } catch {}
    };
  }, [projectId, setProject, hydrate, setError]);

  useEffect(() => {
    if (!projectId) return undefined;

    type LayerSnapshot = { layers: ReturnType<typeof useLayerStore.getState>['layers']; activeLayerId: string | null };
    type CanvasSnapshot = { zoom: number; panX: number; panY: number };

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
      const markDirty = hydrationReadyRef.current && store.hydrated;
      store.updatePartial({
        canvas: {
          zoom: canvasState.zoom,
          panX: canvasState.panX,
          panY: canvasState.panY,
        },
      }, { markDirty });
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
      (next) => syncCanvas(next),
      { equalityFn: shallow },
    );

    return () => {
      unsubLayers();
      unsubCanvas();
    };
  }, [projectId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useProjectAutosave(projectId);

  return null;
}
