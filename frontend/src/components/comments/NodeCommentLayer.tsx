import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNodes, useViewport } from 'reactflow';
import { MessageCircle, MessageSquarePlus } from 'lucide-react';
import { useNodeComments } from '@/hooks/useNodeComments';
import NodeCommentThreadPanel from './NodeCommentThread';

/**
 * 节点评论浮层。挂在 FlowInner 内 ReactFlow 同级（仍在 ReactFlowProvider 内），
 * 用 ReactFlow 节点坐标 + 视口变换把气泡角标投影到节点右上角——走 Flow 坐标而非
 * Paper world 坐标，避免跨端 DPR 错位（光标层那套坑只针对 Paper 画布）。
 */
const NodeCommentLayer: React.FC = () => {
  const nodes = useNodes();
  const { x: vx, y: vy, zoom } = useViewport();
  const {
    threadsByNode,
    currentUserId,
    members,
    createThread,
    reply,
    editComment,
    removeComment,
    setResolved,
  } = useNodeComments();

  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  // 浮层容器(铺满 flow 画布区)的尺寸：用于把弹层夹在容器内，而非用 window 尺寸
  // (画布可能被侧栏/顶栏偏移，window 夹取会错位)。
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [layerSize, setLayerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const update = () => setLayerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 节点屏幕坐标（右上角）。
  const anchors = useMemo(() => {
    const map = new Map<string, { x: number; y: number; selected: boolean; active: boolean; count: number }>();
    for (const n of nodes) {
      const threads = threadsByNode.get(n.id);
      // 单一会话：有未解决评论即「活跃」，角标显示会话内未删除消息条数。
      const active = threads ? threads.some((t) => !t.resolved) : false;
      const count = threads
        ? threads.reduce((acc, t) => acc + t.comments.filter((c) => !c.deleted).length, 0)
        : 0;
      const selected = Boolean(n.selected);
      // 只为「有未解决评论」或「当前选中」的节点显示入口，避免画布密密麻麻。
      if (!active && !selected) continue;
      const abs = (n as any).positionAbsolute ?? n.position;
      const w = n.width ?? 0;
      const screenX = (abs.x + w) * zoom + vx;
      const screenY = abs.y * zoom + vy;
      map.set(n.id, { x: screenX, y: screenY, selected, active, count });
    }
    return map;
  }, [nodes, threadsByNode, vx, vy, zoom]);

  // 打开的节点若消失/无入口则关闭。
  useEffect(() => {
    if (openNodeId && !anchors.has(openNodeId)) setOpenNodeId(null);
  }, [anchors, openNodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenNodeId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 失焦隐藏：点击面板、portal 菜单(data-comment-ui)、评论角标(data-comment-pin)以外区域关闭面板。
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openNodeId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (t.closest('[data-comment-ui]') || t.closest('[data-comment-pin]')) return;
      setOpenNodeId(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openNodeId]);

  const openAnchor = openNodeId ? anchors.get(openNodeId) : null;

  const PANEL_W = 300;
  const PANEL_GAP = 8;

  return (
    <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {[...anchors.entries()].map(([nodeId, a]) => {
        const active = a.active;
        return (
          <button
            key={nodeId}
            data-comment-pin
            onClick={(e) => {
              e.stopPropagation();
              setOpenNodeId((cur) => (cur === nodeId ? null : nodeId));
            }}
            title={active ? `${a.count} 条评论` : '添加评论'}
            style={{
              position: 'absolute',
              left: a.x,
              top: a.y,
              transform: 'translate(-2px, -100%)',
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: 24,
              padding: active ? '0 8px' : '0 5px',
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              background: active ? '#2563eb' : openNodeId === nodeId ? '#2563eb' : 'rgba(37,99,235,0.85)',
              color: 'white',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              fontSize: 12,
              fontWeight: 600,
              opacity: active || a.selected ? 1 : 0.85,
            }}
          >
            {active ? <MessageCircle size={14} /> : <MessageSquarePlus size={15} />}
            {active && a.count > 0 && <span>{a.count}</span>}
          </button>
        );
      })}

      {openNodeId && openAnchor && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            // 优先放在角标右侧；右侧放不下则翻到左侧；最终再夹进容器内。
            left: Math.max(
              PANEL_GAP,
              Math.min(
                openAnchor.x + PANEL_GAP + PANEL_W > (layerSize.w || 0)
                  ? openAnchor.x - PANEL_GAP - PANEL_W
                  : openAnchor.x + PANEL_GAP,
                (layerSize.w || PANEL_W + 2 * PANEL_GAP) - PANEL_W - PANEL_GAP,
              ),
            ),
            top: Math.max(PANEL_GAP, Math.min(openAnchor.y - 40, (layerSize.h || 0) - 120)),
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <NodeCommentThreadPanel
            nodeId={openNodeId}
            threads={threadsByNode.get(openNodeId) ?? []}
            currentUserId={currentUserId}
            members={members}
            onCreateThread={createThread}
            onReply={reply}
            onEdit={editComment}
            onRemove={removeComment}
            onResolve={setResolved}
            onClose={() => setOpenNodeId(null)}
          />
        </div>
      )}
    </div>
  );
};

export default NodeCommentLayer;
