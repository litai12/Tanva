import assert from 'node:assert/strict';
import test from 'node:test';
import { clampDesktopSurfaceWidth, useDesktopSurfaceStore } from './surfaceState.ts';

test('desktop surface width remains within the host safety bounds', () => {
  assert.equal(clampDesktopSurfaceWidth(100), 320);
  assert.equal(clampDesktopSurfaceWidth(760.4), 760);
  assert.equal(clampDesktopSurfaceWidth(4000), 1440);
});

test('desktop plugins remember independent docked widths', () => {
  useDesktopSurfaceStore.setState({
    activePluginId: null,
    lastPluginId: null,
    manuallyDismissedPluginId: null,
    mode: 'closed',
    widthByPluginId: {},
  });
  const state = useDesktopSurfaceStore.getState();
  state.setDockedWidth('tanva.canvas', 900);
  state.setDockedWidth('tanva.local-tools', 520);
  assert.deepEqual(useDesktopSurfaceStore.getState().widthByPluginId, {
    'tanva.canvas': 900,
    'tanva.local-tools': 520,
  });
});

test('manual dismissal blocks repeated agent auto-open until the next user turn', () => {
  const state = useDesktopSurfaceStore.getState();
  state.open('tanva.canvas', 'docked');
  state.dismiss('tanva.canvas');
  state.requestOpen('tanva.canvas', 'docked');
  assert.equal(useDesktopSurfaceStore.getState().mode, 'closed');

  useDesktopSurfaceStore.getState().clearManualDismissal();
  useDesktopSurfaceStore.getState().requestOpen('tanva.canvas', 'docked');
  assert.equal(useDesktopSurfaceStore.getState().activePluginId, 'tanva.canvas');
  assert.equal(useDesktopSurfaceStore.getState().mode, 'docked');
});

test('closing and restoring a plugin preserves the last plugin identity', () => {
  const state = useDesktopSurfaceStore.getState();
  state.open('tanva.canvas', 'docked');
  state.close();
  assert.equal(useDesktopSurfaceStore.getState().mode, 'closed');
  useDesktopSurfaceStore.getState().toggle();
  assert.equal(useDesktopSurfaceStore.getState().activePluginId, 'tanva.canvas');
  assert.equal(useDesktopSurfaceStore.getState().mode, 'docked');
});
