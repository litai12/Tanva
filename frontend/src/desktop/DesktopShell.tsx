import { useEffect, useRef } from 'react';
import { useAIChatStore } from '@/stores/aiChatStore';
import DesktopSidebar from './DesktopSidebar';
import DesktopTaskThread from './DesktopTaskThread';
import PluginSurfaceHost from './plugins/PluginSurfaceHost';
import {
  registerBuiltinDesktopPlugins,
  TANVA_ARTIFACTS_PLUGIN_ID,
  TANVA_CANVAS_PLUGIN_ID,
  TANVA_MEDIA_PREVIEW_PLUGIN_ID,
} from './plugins/builtins';
import {
  DESKTOP_ARTIFACT_OPEN_EVENT,
  useDesktopArtifactStore,
  type DesktopArtifact,
} from './artifacts/artifactState';
import {
  DESKTOP_SURFACE_REQUEST_EVENT,
  DESKTOP_SURFACE_CLOSE_REQUEST_EVENT,
  DESKTOP_SURFACE_AUTO_OPEN_RESET_EVENT,
  type DesktopSurfaceCloseRequest,
  type DesktopSurfaceRequest,
} from './plugins/surfaceEvents';
import { desktopPluginRegistry } from './plugins/registry';
import { useDesktopSurfaceStore } from './plugins/surfaceState';
import { useDesktopTaskContextStore } from './taskContextState';
import {
  DESKTOP_MEDIA_PREVIEW_OPEN_EVENT,
  useDesktopMediaPreviewStore,
  type DesktopMediaPreview,
} from './media/mediaPreviewState';

registerBuiltinDesktopPlugins();

export default function DesktopShell() {
  const surfaceMode = useDesktopSurfaceStore((state) => state.mode);
  const openSurface = useDesktopSurfaceStore((state) => state.open);
  const requestOpenSurface = useDesktopSurfaceStore((state) => state.requestOpen);
  const closeSurface = useDesktopSurfaceStore((state) => state.close);
  const dismissSurface = useDesktopSurfaceStore((state) => state.dismiss);
  const clearManualDismissal = useDesktopSurfaceStore((state) => state.clearManualDismissal);
  const currentSessionId = useAIChatStore((state) => state.currentSessionId);
  const previousSessionId = useRef(currentSessionId);
  const sidebarVisible = useDesktopTaskContextStore((state) => state.sidebarVisible);
  const toggleSidebar = useDesktopTaskContextStore((state) => state.toggleSidebar);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'b') return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [toggleSidebar]);

  useEffect(() => {
    if (
      previousSessionId.current &&
      currentSessionId &&
      previousSessionId.current !== currentSessionId
    ) {
      closeSurface();
      clearManualDismissal();
    }
    previousSessionId.current = currentSessionId;
  }, [clearManualDismissal, closeSurface, currentSessionId]);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const request = (event as CustomEvent<DesktopSurfaceRequest>).detail;
      if (!request?.pluginId) return;
      if (!desktopPluginRegistry.get(request.pluginId)) {
        console.warn(`Ignored unregistered desktop plugin request: ${request.pluginId}`);
        return;
      }
      requestOpenSurface(request.pluginId, request.mode || 'docked');
    };
    window.addEventListener(DESKTOP_SURFACE_REQUEST_EVENT, handleRequest);
    return () => window.removeEventListener(DESKTOP_SURFACE_REQUEST_EVENT, handleRequest);
  }, [requestOpenSurface]);

  useEffect(() => {
    const handleCloseRequest = (event: Event) => {
      const request = (event as CustomEvent<DesktopSurfaceCloseRequest>).detail;
      const activePluginId = useDesktopSurfaceStore.getState().activePluginId;
      if (!request?.pluginId || request.pluginId === activePluginId) {
        dismissSurface(request?.pluginId);
      }
    };
    window.addEventListener(DESKTOP_SURFACE_CLOSE_REQUEST_EVENT, handleCloseRequest);
    return () =>
      window.removeEventListener(DESKTOP_SURFACE_CLOSE_REQUEST_EVENT, handleCloseRequest);
  }, [dismissSurface]);

  useEffect(() => {
    const resetAutoOpen = () => clearManualDismissal();
    window.addEventListener(DESKTOP_SURFACE_AUTO_OPEN_RESET_EVENT, resetAutoOpen);
    return () =>
      window.removeEventListener(DESKTOP_SURFACE_AUTO_OPEN_RESET_EVENT, resetAutoOpen);
  }, [clearManualDismissal]);

  useEffect(() => {
    const openCanvas = () => requestOpenSurface(TANVA_CANVAS_PLUGIN_ID, 'docked');
    window.addEventListener('tanva:open-canvas-surface', openCanvas);
    return () => window.removeEventListener('tanva:open-canvas-surface', openCanvas);
  }, [requestOpenSurface]);

  useEffect(() => {
    const openArtifact = (event: Event) => {
      const artifact = (event as CustomEvent<DesktopArtifact>).detail;
      if (!artifact?.id || !artifact.title) return;
      useDesktopArtifactStore.getState().upsert(artifact);
      openSurface(TANVA_ARTIFACTS_PLUGIN_ID, 'docked');
    };
    window.addEventListener(DESKTOP_ARTIFACT_OPEN_EVENT, openArtifact);
    return () => window.removeEventListener(DESKTOP_ARTIFACT_OPEN_EVENT, openArtifact);
  }, [openSurface]);

  useEffect(() => {
    const openMediaPreview = (event: Event) => {
      const preview = (event as CustomEvent<DesktopMediaPreview>).detail;
      if (!preview?.id || !preview.title || preview.items.length === 0) return;
      useDesktopMediaPreviewStore.getState().open(preview);
      openSurface(TANVA_MEDIA_PREVIEW_PLUGIN_ID, 'docked');
    };
    window.addEventListener(DESKTOP_MEDIA_PREVIEW_OPEN_EVENT, openMediaPreview);
    return () =>
      window.removeEventListener(DESKTOP_MEDIA_PREVIEW_OPEN_EVENT, openMediaPreview);
  }, [openSurface]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-slate-950">
      {sidebarVisible && <DesktopSidebar />}
      {surfaceMode !== 'maximized' && <DesktopTaskThread />}
      <PluginSurfaceHost />
    </div>
  );
}
