import React, { createContext, useCallback, useContext, useEffect } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasCollab, type CanvasCollabHandle } from '@/hooks/useCanvasCollab';
import { collabCanvasBridge } from './collabCanvasBridge';

/**
 * 共享的画布协作句柄。此前 useCanvasCollab 只在 CollabRoot 内部实例化，
 * FlowOverlay/画布层无法访问，导致编辑无法采集/广播。改为在 Canvas 顶层
 * 由 CollabProvider 实例化一次，经 Context 下发给 CollabRoot 与 FlowOverlay。
 */
const CollabContext = createContext<CanvasCollabHandle | null>(null);

export function useCollab(): CanvasCollabHandle | null {
  return useContext(CollabContext);
}

export const CollabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const projectId = useProjectStore((s) => s.currentProjectId);

  // 访问被撤销 / 需要全量快照：通过 window 事件解耦，由 CollabRoot（持有 Toast 宿主）
  // 与内容加载逻辑各自监听处理，避免在此处耦合 UI。
  const onAccessRevoked = useCallback(() => {
    window.dispatchEvent(new CustomEvent('collab:access-revoked'));
  }, []);
  const onSnapshotRequired = useCallback(() => {
    window.dispatchEvent(new CustomEvent('collab:snapshot-required'));
  }, []);

  const collab = useCanvasCollab({
    projectId: projectId ?? '',
    onAccessRevoked,
    onSnapshotRequired,
  });

  // 画布图片协作桥：订阅远端 canvas_patch 并以 window 事件下发给画布层。
  useEffect(() => {
    collabCanvasBridge.init();
  }, []);

  return <CollabContext.Provider value={collab}>{children}</CollabContext.Provider>;
};
