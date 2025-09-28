import { useEffect, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { projectApi } from '@/services/projectApi';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useLayerStore } from '@/stores/layerStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { createEmptyProjectContent } from '@/types/project';
import { useProjectAutosave } from '@/hooks/useProjectAutosave';
import { paperSaveService } from '@/services/paperSaveService';
import { saveMonitor } from '@/utils/saveMonitor';
import { useProjectStore } from '@/stores/projectStore';

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
      setProject(null);
      return undefined;
    }

    let cancelled = false;
    hydrationReadyRef.current = false;
    setProject(projectId);

    (async () => {
      try {
        const data = await projectApi.getContent(projectId);
        if (cancelled) return;

        hydrate(data.content, data.version, data.updatedAt ?? null);
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
        setError(err?.message || '加载项目内容失败');
        hydrationReadyRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
      hydrationReadyRef.current = false;
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
