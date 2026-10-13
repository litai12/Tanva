/** Shared shortcut definitions; an empty override disables every default alias. */
export const SHORTCUT_ACTIONS = [
  { id: 'undo', labelZh: '撤销', labelEn: 'Undo', category: 'general', defaultBindings: ['Mod+Z'] },
  { id: 'redo', labelZh: '重做', labelEn: 'Redo', category: 'general', defaultBindings: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'save', labelZh: '保存项目', labelEn: 'Save project', category: 'general', defaultBindings: ['Mod+S'] },
  { id: 'copyJson', labelZh: '复制画布 / 对话 JSON', labelEn: 'Copy canvas / chat JSON', category: 'general', defaultBindings: ['Mod+Shift+C'] },
  { id: 'pasteJson', labelZh: '导入画布 / 对话 JSON', labelEn: 'Import canvas / chat JSON', category: 'general', defaultBindings: ['Mod+Shift+V'] },
  { id: 'copy', labelZh: '复制选中内容', labelEn: 'Copy selection', category: 'canvas', defaultBindings: ['Mod+C'] },
  { id: 'paste', labelZh: '粘贴内容', labelEn: 'Paste', category: 'canvas', defaultBindings: ['Mod+V'] },
  { id: 'selectAll', labelZh: '全选画布元素', labelEn: 'Select all canvas elements', category: 'canvas', defaultBindings: ['Mod+A'] },
  { id: 'delete', labelZh: '删除选中内容', labelEn: 'Delete selection', category: 'canvas', defaultBindings: ['Delete', 'Backspace'] },
  { id: 'temporaryPan', labelZh: '按住平移画布', labelEn: 'Hold to pan canvas', category: 'canvas', defaultBindings: ['Space'] },
  { id: 'fitView', labelZh: '适合选区 / 屏幕', labelEn: 'Fit selection / screen', category: 'canvas', defaultBindings: ['Z'] },
  { id: 'group', labelZh: '节点分组', labelEn: 'Group nodes', category: 'flow', defaultBindings: ['G'] },
  { id: 'ungroup', labelZh: '节点解组', labelEn: 'Ungroup nodes', category: 'flow', defaultBindings: ['Shift+G'] },
  { id: 'pasteKeepLinks', labelZh: '粘贴节点并保留连线', labelEn: 'Paste nodes with connections', category: 'flow', defaultBindings: ['Mod+Shift+V'] },
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutActionId = ShortcutAction['id'];
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string[]>>;
export type ShortcutKeyboardEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & Partial<Pick<KeyboardEvent, 'isComposing' | 'keyCode'>>;

const MODIFIERS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'OS']);
const KEY_ALIASES: Record<string, string> = { ' ': 'Space', spacebar: 'Space', space: 'Space', esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', return: 'Enter', tab: 'Tab', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', '+': 'Plus', plus: 'Plus' };

const normalizeKey = (key: string): string | null => {
  if (MODIFIERS.has(key) || ['Dead', 'Process', 'Unidentified'].includes(key)) return null;
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
  return key.length === 1 ? key.toUpperCase() : null;
};

/** Mod deliberately accepts both Ctrl and Command, so preferences work cross-platform. */
export const normalizeShortcut = (event: ShortcutKeyboardEvent): string | null => {
  if (event.isComposing || event.keyCode === 229 || ['Dead', 'Process', 'Unidentified'].includes(event.key)) return null;
  let key = normalizeKey(event.key);
  // The physical key keeps Alt/Shift combinations and non-Latin layouts stable.
  if (!MODIFIERS.has(event.key) && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  if (!MODIFIERS.has(event.key) && /^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  if (!key) return null;
  return [event.ctrlKey || event.metaKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
};

export const normalizeShortcutBinding = (binding: string): string | null => {
  if (typeof binding !== 'string') return null;
  const parts = binding.trim().split('+').map((part) => part.trim());
  const key = normalizeKey(parts.pop() || '');
  if (!key) return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const value = part.toLowerCase();
    if (['mod', 'ctrl', 'control', 'cmd', 'command', 'meta'].includes(value)) modifiers.add('Mod');
    else if (value === 'alt' || value === 'option') modifiers.add('Alt');
    else if (value === 'shift') modifiers.add('Shift');
    else return null;
  }
  return [...['Mod', 'Alt', 'Shift'].filter((modifier) => modifiers.has(modifier)), key].join('+');
};

export const matchesShortcutBinding = (binding: string, event: ShortcutKeyboardEvent): boolean =>
  normalizeShortcutBinding(binding) === normalizeShortcut(event) && normalizeShortcut(event) !== null;

export const getEffectiveBindings = (id: ShortcutActionId, overrides: ShortcutOverrides): readonly string[] =>
  overrides[id] ?? SHORTCUT_ACTIONS.find((action) => action.id === id)!.defaultBindings;

/** JSON import delegates to linked-node paste within Flow; their defaults intentionally overlap. */
const shareContextualBinding = (first: ShortcutActionId, second: ShortcutActionId) =>
  (first === 'pasteJson' && second === 'pasteKeepLinks') || (first === 'pasteKeepLinks' && second === 'pasteJson');

export const findShortcutConflict = (id: ShortcutActionId, binding: string, overrides: ShortcutOverrides): ShortcutAction | undefined => {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return undefined;
  return SHORTCUT_ACTIONS.find((action) => action.id !== id && !shareContextualBinding(id, action.id) &&
    getEffectiveBindings(action.id, overrides).some((existing) => normalizeShortcutBinding(existing) === normalized));
};

/** Validate persisted data as well as UI recordings; unknown actions never enter runtime state. */
export const sanitizeShortcutOverrides = (value: unknown): ShortcutOverrides => {
  if (!value || typeof value !== 'object') return {};
  const result: ShortcutOverrides = {};
  for (const action of SHORTCUT_ACTIONS) {
    const bindings = (value as Record<string, unknown>)[action.id];
    if (!Array.isArray(bindings)) continue;
    if (bindings.length === 0) { result[action.id] = []; continue; }
    const normalized = bindings.filter((binding): binding is string => typeof binding === 'string').map(normalizeShortcutBinding).filter((binding): binding is string => !!binding);
    if (normalized.length) result[action.id] = [...new Set(normalized)];
  }
  // Drop conflicting persisted overrides rather than load ambiguous dispatches.
  let removed: boolean;
  do {
    removed = false;
    for (const action of SHORTCUT_ACTIONS) {
      if (result[action.id]?.some((binding) => findShortcutConflict(action.id, binding, result))) {
        delete result[action.id];
        removed = true;
      }
    }
  } while (removed);
  return result;
};

export const formatShortcut = (binding: string, isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)): string => {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return binding;
  return normalized.split('+').map((part) => part === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : part === 'Alt' && isMac ? '⌥' : part === 'Shift' && isMac ? '⇧' : part === 'Plus' ? '+' : part).join(isMac ? '' : ' + ');
};

export const isEditableShortcutTarget = (event: Pick<KeyboardEvent, 'target'>): boolean => {
  const editable = (target: EventTarget | null): boolean => {
    if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
    return !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || (target as HTMLElement).isContentEditable;
  };
  return editable(event.target) || (typeof document !== 'undefined' && editable(document.activeElement));
};
