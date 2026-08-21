import { Suspense, useCallback, useEffect, useRef } from 'react';
import { Maximize2, Minimize2, PanelRightClose, Puzzle } from 'lucide-react';
import RuntimeErrorBoundary from '@/components/RuntimeErrorBoundary';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { useDesktopPlugins } from './registry';
import { useDesktopSurfaceStore } from './surfaceState';

export default function PluginSurfaceHost() {
  const projectId = useProjectStore((state) => state.currentProjectId);
  const currentProject = useProjectStore((state) => state.currentProject);
  const activePluginId = useDesktopSurfaceStore((state) => state.activePluginId);
  const mode = useDesktopSurfaceStore((state) => state.mode);
  const widthByPluginId = useDesktopSurfaceStore((state) => state.widthByPluginId);
  const close = useDesktopSurfaceStore((state) => state.close);
  const dismiss = useDesktopSurfaceStore((state) => state.dismiss);
  const maximize = useDesktopSurfaceStore((state) => state.maximize);
  const restore = useDesktopSurfaceStore((state) => state.restore);
  const setDockedWidth = useDesktopSurfaceStore((state) => state.setDockedWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const plugins = useDesktopPlugins();
  const plugin = plugins.find((definition) => definition.manifest.id === activePluginId) ?? null;
  const dockedWidth = activePluginId
    ? widthByPluginId[activePluginId] ?? plugin?.manifest.surface.defaultWidth ?? 760
    : 760;

  useEffect(() => {
    if (mode !== 'closed' && activePluginId && !plugin) close();
  }, [activePluginId, close, mode, plugin]);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (mode !== 'docked') return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: dockedWidth };
    },
    [dockedWidth, mode]
  );

  const resize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!activePluginId) return;
      setDockedWidth(activePluginId, drag.startWidth + drag.startX - event.clientX);
    },
    [activePluginId, setDockedWidth]
  );

  const stopResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }, []);

  if (mode === 'closed' || !plugin) return null;

  const PluginComponent = plugin.component;
  const canMaximize = plugin.manifest.surface.supportsMaximize;
  const effectiveWidth = Math.min(
    plugin.manifest.surface.maxWidth,
    Math.max(plugin.manifest.surface.minWidth, dockedWidth)
  );

  return (
    <section
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white',
        mode === 'maximized' && 'flex-1'
      )}
      style={mode === 'docked' ? { width: effectiveWidth, flex: '0 0 auto' } : undefined}
      aria-label={`${plugin.manifest.name}工具面`}
    >
      {mode === 'docked' && (
        <div
          className="absolute inset-y-0 left-0 z-[120] w-1.5 cursor-col-resize touch-none hover:bg-blue-500/30"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          aria-hidden="true"
        />
      )}

      <header className="flex h-12 flex-none items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur-xl">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Puzzle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">
            {plugin.manifest.surface.title}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {plugin.manifest.context === 'global'
              ? '全局扩展'
              : currentProject?.name || '未选择项目'}
          </div>
        </div>
        {canMaximize && (
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={mode === 'maximized' ? restore : maximize}
            title={mode === 'maximized' ? '恢复工具面' : '最大化工具面'}
          >
            {mode === 'maximized' ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onClick={() => dismiss(plugin.manifest.id)}
          title="关闭工具面"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <RuntimeErrorBoundary
          label={`${plugin.manifest.name}插件`}
          resetKeys={[plugin.manifest.id, projectId, mode]}
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                正在打开{plugin.manifest.name}…
              </div>
            }
          >
            <PluginComponent
              projectId={projectId}
              isMaximized={mode === 'maximized'}
              closeSurface={() => dismiss(plugin.manifest.id)}
              restoreSurface={restore}
            />
          </Suspense>
        </RuntimeErrorBoundary>
      </div>
    </section>
  );
}
