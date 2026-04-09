import type { CSSProperties } from 'react';
import { useAIChatStore } from '@/stores/aiChatStore';

export function useFlowNodeDarkTheme(): boolean {
  return useAIChatStore((state) => state.chatTheme === 'black');
}

export const FLOW_NODE_DARK_SURFACE = {
  imageWellBg: '#161616',
  imageWellBorder: '#2f2f2f',
  letterboxBg: '#161616',
  gridFrameBg: '#161616',
  audioDropzoneBg: '#1a1a1a',
  audioDropzoneBorder: '#333333',
} as const;

export function flowImagePreviewWell(
  isDark: boolean,
  light: { background: string; border: string }
): Pick<CSSProperties, 'background' | 'border'> {
  if (!isDark) {
    return { background: light.background, border: light.border };
  }
  return {
    background: FLOW_NODE_DARK_SURFACE.imageWellBg,
    border: `1px solid ${FLOW_NODE_DARK_SURFACE.imageWellBorder}`,
  };
}

export function flowLetterboxBackground(isDark: boolean): string {
  return isDark ? FLOW_NODE_DARK_SURFACE.letterboxBg : '#fff';
}

export function flowSpeechHistoryRow(
  isDark: boolean,
  isActive: boolean
): Pick<CSSProperties, 'border' | 'background'> {
  if (!isDark) {
    return {
      border: isActive ? '1px solid #93c5fd' : '1px solid #e5e7eb',
      background: isActive ? '#eff6ff' : '#fff',
    };
  }
  return {
    border: isActive ? '1px solid #3b82f6' : '1px solid #333333',
    background: isActive ? 'rgba(37, 99, 235, 0.18)' : '#1d1d1d',
  };
}

export function flowSpeechHistorySectionDivider(isDark: boolean): string {
  return isDark ? '#333333' : '#f0f0f0';
}

export function flowAudioPlayerShell(isDark: boolean): CSSProperties {
  if (!isDark) {
    return { width: '100%' };
  }
  return {
    width: '100%',
    padding: 6,
    borderRadius: 8,
    background: FLOW_NODE_DARK_SURFACE.audioDropzoneBg,
    border: `1px solid ${FLOW_NODE_DARK_SURFACE.audioDropzoneBorder}`,
    boxSizing: 'border-box',
  };
}

export function flowSpeechHistoryPromptColor(isDark: boolean): string {
  return isDark ? '#e5e7eb' : '#111827';
}

export function flowSpeechHistoryMetaColor(isDark: boolean): string {
  return isDark ? '#9ca3af' : '#6b7280';
}

export function flowSpeechDownloadButton(
  isDark: boolean
): Pick<CSSProperties, 'border' | 'background' | 'color'> {
  if (!isDark) {
    return {
      border: '1px solid #d1d5db',
      background: '#fff',
      color: '#374151',
    };
  }
  return {
    border: '1px solid #404040',
    background: '#2a2a2a',
    color: '#e5e7eb',
  };
}

/** 节点外框（画布暗色主题下与浅色主题下的卡片底） */
export function flowNodeShellChrome(
  isDark: boolean,
  selected: boolean
): { borderColor: string; background: string; color: string } {
  return {
    borderColor: selected ? '#2563eb' : isDark ? '#333333' : '#e5e7eb',
    background: isDark ? '#1c1c1c' : '#ffffff',
    color: isDark ? '#e5e7eb' : '#111827',
  };
}

/** 次级内容区（对应浅色的 #f9fafb） */
export function flowNodeMutedWellBackground(isDark: boolean): string {
  return isDark ? '#161616' : '#f9fafb';
}

/** 占位/弱边框（对应 #eef0f2） */
export function flowNodeWellOutlineBorder(isDark: boolean): string {
  return isDark ? '#333333' : '#eef0f2';
}

/** 输入框、下拉等控件表面 */
export function flowNodeControlField(
  isDark: boolean
): Pick<CSSProperties, 'background' | 'border' | 'color'> {
  if (!isDark) {
    return {
      background: '#ffffff',
      border: '1px solid #d1d5db',
      color: '#111827',
    };
  }
  return {
    background: '#252525',
    border: '1px solid #404040',
    color: '#e5e7eb',
  };
}
