export const DESKTOP_SURFACE_REQUEST_EVENT = 'tanva:desktop-surface-request';
export const DESKTOP_SURFACE_CLOSE_REQUEST_EVENT = 'tanva:desktop-surface-close-request';
export const DESKTOP_SURFACE_AUTO_OPEN_RESET_EVENT = 'tanva:desktop-surface-auto-open-reset';

export interface DesktopSurfaceRequest {
  pluginId: string;
  mode?: 'docked' | 'maximized';
  reason?: string;
}

export interface DesktopSurfaceCloseRequest {
  pluginId?: string;
  reason?: string;
}

export const requestDesktopSurface = (request: DesktopSurfaceRequest): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DesktopSurfaceRequest>(DESKTOP_SURFACE_REQUEST_EVENT, {
      detail: request,
    })
  );
};

export const requestDesktopSurfaceClose = (
  request: DesktopSurfaceCloseRequest = {}
): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DesktopSurfaceCloseRequest>(DESKTOP_SURFACE_CLOSE_REQUEST_EVENT, {
      detail: request,
    })
  );
};

export const resetDesktopSurfaceAutoOpenSuppression = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DESKTOP_SURFACE_AUTO_OPEN_RESET_EVENT));
};
