import assert from 'node:assert/strict';
import test from 'node:test';
import { isShortcutSuppressed, useShortcutStore } from './shortcutStore.ts';

const key = (value: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent => ({ key: value, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, isComposing: false, keyCode: 0, target: null, ...options }) as KeyboardEvent;
const reset = () => useShortcutStore.setState({ overrides: {}, settingsOpen: false, recordingActionId: null });

test('rebinding replaces redo aliases; clear/reset affect every alias immediately', () => {
  reset();
  const store = useShortcutStore.getState();
  assert.deepEqual(store.setBinding('redo', 'Alt+R'), { ok: true });
  assert.equal(store.matchesShortcut('redo', key('r', { altKey: true })), true);
  assert.equal(store.matchesShortcut('redo', key('z', { ctrlKey: true, shiftKey: true })), false);
  assert.equal(store.matchesShortcut('redo', key('y', { metaKey: true })), false);
  store.clearBinding('redo');
  assert.equal(store.matchesShortcut('redo', key('r', { altKey: true })), false);
  assert.deepEqual(store.resetBinding('redo'), { ok: true });
  assert.equal(store.matchesShortcut('redo', key('y', { metaKey: true })), true);
  assert.equal(store.matchesShortcut('redo', key('z', { ctrlKey: true, shiftKey: true })), true);
});

test('conflicting changes and restoring reassigned defaults leave state unchanged', () => {
  reset();
  const store = useShortcutStore.getState();
  assert.equal(store.setBinding('save', 'Mod+Z').ok, false);
  assert.equal(store.setBinding('save', 'Control').ok, false);
  assert.deepEqual(useShortcutStore.getState().overrides, {});
  store.clearBinding('undo');
  assert.deepEqual(store.setBinding('save', 'Mod+Z'), { ok: true });
  const result = store.resetBinding('undo');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.conflict?.id, 'save');
  assert.deepEqual(useShortcutStore.getState().overrides, { undo: [], save: ['Mod+Z'] });
  store.resetAll();
  assert.deepEqual(useShortcutStore.getState().overrides, {});
});

test('settings, recording, IME and handled events suppress every runtime action', () => {
  reset();
  const store = useShortcutStore.getState();
  const save = key('s', { ctrlKey: true });
  assert.equal(store.matchesShortcut('save', save), true);
  store.setSettingsOpen(true);
  assert.equal(isShortcutSuppressed(), true);
  assert.equal(store.matchesShortcut('save', save), false);
  store.setSettingsOpen(false);
  store.setRecordingActionId('save');
  assert.equal(store.matchesShortcut('save', save), false);
  store.setRecordingActionId(null);
  assert.equal(store.matchesShortcut('save', key('s', { ctrlKey: true, isComposing: true })), false);
  assert.equal(store.matchesShortcut('save', key('s', { ctrlKey: true, keyCode: 229 })), false);
  assert.equal(store.matchesShortcut('save', key('s', { ctrlKey: true, defaultPrevented: true })), false);
});

test('editable inputs preserve modified save but never execute plain remapped save', () => {
  reset();
  const previousElement = globalThis.Element;
  class FakeElement { isContentEditable = false; closest() { return this; } }
  Object.assign(globalThis, { Element: FakeElement });
  try {
    const target = new FakeElement() as unknown as EventTarget;
    const store = useShortcutStore.getState();
    assert.equal(store.matchesShortcut('save', key('s', { ctrlKey: true, target })), true);
    assert.equal(store.matchesShortcut('undo', key('z', { ctrlKey: true, target })), false);
    assert.deepEqual(store.setBinding('save', 'S'), { ok: true });
    assert.equal(store.matchesShortcut('save', key('s', { target })), false);
    assert.deepEqual(store.setBinding('save', 'Alt+S'), { ok: true });
    assert.equal(store.matchesShortcut('save', key('s', { altKey: true, target })), false);
  } finally {
    Object.assign(globalThis, { Element: previousElement });
  }
});

test('persistence saves only overrides and rehydrates cleared and custom bindings', async () => {
  reset();
  const store = useShortcutStore.getState();
  store.setBinding('save', 'Alt+S');
  store.clearBinding('redo');
  store.setSettingsOpen(true);
  store.setRecordingActionId('save');
  const storage = useShortcutStore.persist.getOptions().storage!;
  const saved = await storage.getItem('keyboard-shortcuts');
  assert.deepEqual(saved?.state, { overrides: { save: ['Alt+S'], redo: [] } });
  reset();
  await storage.setItem('keyboard-shortcuts', saved!);
  await useShortcutStore.persist.rehydrate();
  assert.deepEqual(useShortcutStore.getState().overrides, { save: ['Alt+S'], redo: [] });
  assert.equal(useShortcutStore.getState().settingsOpen, false);
  assert.equal(useShortcutStore.getState().recordingActionId, null);
  assert.equal(store.matchesShortcut('save', key('s', { altKey: true })), true);
  assert.equal(store.matchesShortcut('redo', key('y', { ctrlKey: true })), false);
  reset();
});

test('focus mode supports Tab, rebinding, clearing, reset and recording protection', () => {
  reset();
  const store = useShortcutStore.getState();
  assert.equal(store.matchesShortcut('focusMode', key('Tab')), true);
  assert.equal(store.matchesShortcut('focusMode', key('Tab', { shiftKey: true })), false);
  store.setSettingsOpen(true);
  assert.equal(store.matchesShortcut('focusMode', key('Tab')), false);
  store.setSettingsOpen(false);
  store.setRecordingActionId('focusMode');
  assert.equal(store.matchesShortcut('focusMode', key('Tab')), false);
  store.setRecordingActionId(null);
  assert.deepEqual(store.setBinding('focusMode', 'Alt+F'), { ok: true });
  assert.equal(store.matchesShortcut('focusMode', key('Tab')), false);
  assert.equal(store.matchesShortcut('focusMode', key('f', { altKey: true })), true);
  store.clearBinding('focusMode');
  assert.equal(store.matchesShortcut('focusMode', key('f', { altKey: true })), false);
  assert.deepEqual(store.resetBinding('focusMode'), { ok: true });
  assert.equal(store.matchesShortcut('focusMode', key('Tab')), true);
  reset();
});
