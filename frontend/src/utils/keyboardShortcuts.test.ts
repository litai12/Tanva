import assert from 'node:assert/strict';
import test from 'node:test';
import { findShortcutConflict, formatShortcut, getEffectiveBindings, matchesShortcutBinding, normalizeShortcut, normalizeShortcutBinding, sanitizeShortcutOverrides } from './keyboardShortcuts.ts';
import type { ShortcutKeyboardEvent } from './keyboardShortcuts.ts';

const key = (value: string, options: Partial<ShortcutKeyboardEvent> = {}): ShortcutKeyboardEvent => ({ key: value, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...options });

test('normalizes Ctrl and Command, modifier order and case across platforms', () => {
  assert.equal(normalizeShortcut(key('z', { ctrlKey: true, shiftKey: true })), 'Mod+Shift+Z');
  assert.equal(normalizeShortcut(key('Z', { metaKey: true, shiftKey: true })), 'Mod+Shift+Z');
  assert.equal(normalizeShortcutBinding('shift + cmd + z'), 'Mod+Shift+Z');
  assert.equal(normalizeShortcutBinding('Ctrl+Alt+f12'), 'Mod+Alt+F12');
});

test('normalizes hold keys, Plus, shifted letters and non-Latin layouts', () => {
  assert.equal(normalizeShortcut(key(' ', { code: 'Space' })), 'Space');
  assert.equal(normalizeShortcut(key('+', { ctrlKey: true, shiftKey: true })), 'Mod+Shift+Plus');
  assert.equal(normalizeShortcutBinding('Mod+Shift+Plus'), 'Mod+Shift+Plus');
  assert.equal(normalizeShortcut(key('ж', { code: 'KeyG' })), 'G');
  assert.equal(normalizeShortcut(key('!', { code: 'Digit1', shiftKey: true })), 'Shift+1');
});

test('never records modifier-only, dead-key or IME events', () => {
  for (const value of ['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'Dead', 'Process', 'Unidentified']) {
    assert.equal(normalizeShortcut(key(value, { code: 'KeyE' })), null);
  }
  assert.equal(normalizeShortcut(key('z', { code: 'KeyZ', isComposing: true })), null);
  assert.equal(normalizeShortcut(key('z', { keyCode: 229 })), null);
  assert.equal(normalizeShortcutBinding('Mod+Shift'), null);
  assert.equal(normalizeShortcutBinding('Bogus+S'), null);
});

test('matches exact modifiers so neighboring actions do not execute', () => {
  assert.equal(matchesShortcutBinding('Mod+Z', key('z', { metaKey: true })), true);
  assert.equal(matchesShortcutBinding('Mod+Z', key('z', { ctrlKey: true, shiftKey: true })), false);
  assert.equal(matchesShortcutBinding('G', key('g', { altKey: true })), false);
  assert.equal(matchesShortcutBinding('Mod+Shift+Plus', key('+', { ctrlKey: true, shiftKey: true })), true);
});

test('overrides replace all aliases and clearing disables all aliases', () => {
  assert.deepEqual(getEffectiveBindings('redo', {}), ['Mod+Shift+Z', 'Mod+Y']);
  assert.deepEqual(getEffectiveBindings('redo', { redo: ['Alt+R'] }), ['Alt+R']);
  assert.deepEqual(getEffectiveBindings('redo', { redo: [] }), []);
  assert.deepEqual(getEffectiveBindings('delete', { delete: [] }), []);
});

test('conflicts include default aliases but honor cleared and reassigned actions', () => {
  assert.equal(findShortcutConflict('save', 'Ctrl+Y', {})?.id, 'redo');
  assert.equal(findShortcutConflict('save', 'Backspace', {})?.id, 'delete');
  assert.equal(findShortcutConflict('save', 'Mod+Y', { redo: [] }), undefined);
  assert.equal(findShortcutConflict('save', 'Alt+R', { redo: ['Alt+R'] })?.id, 'redo');
  assert.equal(findShortcutConflict('redo', 'Mod+Y', {}), undefined);
});

test('JSON import and Flow linked paste keep their intentional contextual overlap', () => {
  assert.equal(findShortcutConflict('pasteJson', 'Mod+Shift+V', {}), undefined);
  assert.equal(findShortcutConflict('pasteKeepLinks', 'Mod+Shift+V', {}), undefined);
  assert.equal(findShortcutConflict('copy', 'Mod+Shift+V', {})?.id, 'pasteJson');
});

test('persisted overrides reject malformed data and stabilize after conflicting defaults restore', () => {
  assert.deepEqual(sanitizeShortcutOverrides(null), {});
  assert.deepEqual(sanitizeShortcutOverrides({ unknown: ['X'], redo: [], delete: [true], save: ['bad+key'], group: ['alt+g', 'Alt+G'] }), { redo: [], group: ['Alt+G'] });
  // Dropping redo restores Mod+Y, which then invalidates the earlier save override.
  assert.deepEqual(sanitizeShortcutOverrides({ save: ['Mod+Y'], redo: ['G'] }), {});
  assert.deepEqual(sanitizeShortcutOverrides({ undo: ['Mod+Y'], redo: ['Mod+Z'] }), { undo: ['Mod+Y'], redo: ['Mod+Z'] });
});

test('formats readable platform-specific binding labels', () => {
  assert.equal(formatShortcut('Mod+Alt+Shift+Z', true), '⌘⌥⇧Z');
  assert.equal(formatShortcut('Mod+Shift+Z', false), 'Ctrl + Shift + Z');
  assert.equal(formatShortcut('Mod+Shift+Plus', false), 'Ctrl + Shift + +');
  assert.equal(formatShortcut('Space', false), 'Space');
});
