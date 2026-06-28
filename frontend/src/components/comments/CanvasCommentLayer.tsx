import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport } from 'reactflow';
import { Check } from 'lucide-react';
import { useCanvasComments } from '@/contexts/CanvasCommentsContext';
import { useCommentStore } from '@/stores/commentStore';
import CommentThreadPopup, { Avatar } from './CommentThreadPopup';
import CommentComposer from './CommentComposer';
import type { CanvasCommentThread } from '@/services/canvasCommentsApi';

const PANEL_W = 300;
const PANEL_GAP = 12;
const DRAG_THRESHOLD = 4;

/**
 * 画布评论浮层（Figma 式自由落点）。挂在 FlowInner 内、ReactFlow 同级（仍在 ReactFlowProvider 内）。
 * pin 锚定 flow 坐标，用视口变换投影到屏幕；评论模式下点击空白落新 pin；pin 可拖动改位。
 * 坐标走 Flow 坐标而非 Paper world（避免跨端 DPR 错位）。
 */
const CanvasCommentLayer: React.FC = () => {
  const rf = useReactFlow();
  const { x: vx, y: vy, zoom } = useViewport();
  const {
    threads,
    currentUserId,
    members,
    createThread,
    reply,
    editComment,
    removeComment,
    deleteThread,
    setResolved,
    moveThread,
  } = useCanvasComments();

  const active = useCommentStore((s) => s.active);
  const openThreadId = useCommentStore((s) => s.openThreadId);
  const draftPin = useCommentStore((s) => s.draftPin);
  const focusThreadId = useCommentStore((s) => s.focusThreadId);
  const openThread = useCommentStore((s) => s.openThread);
  const closeThread = useCommentStore((s) => s.closeThread);
  const setDraftPin = useCommentStore((s) => s.setDraftPin);
  const consumeFocus = useCommentStore((s) => s.consumeFocus);

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

  // 仅渲染有坐标的线程（自由落点）。
  const positioned = useMemo(
    () => threads.filter((t) => typeof t.x === 'number' && typeof t.y === 'number'),
    [threads],
  );

  const toScreen = (fx: number, fy: number) => ({ x: fx * zoom + vx, y: fy * zoom + vy });

  // 抽屉点击某条评论 → 把该 pin 居中并展开。
  useEffect(() => {
    if (!focusThreadId) return;
    const t = positioned.find((x) => x.id === focusThreadId);
    if (t && typeof t.x === 'number' && typeof t.y === 'number') {
      try {
        rf.setCenter(t.x, t.y, { zoom, duration: 300 });
      } catch {}
    }
    consumeFocus();
  }, [focusThreadId, positioned, rf, zoom, consumeFocus]);

  // ESC 关闭 popup / 取消草稿。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (draftPin) setDraftPin(null);
      else if (openThreadId) closeThread();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draftPin, openThreadId, setDraftPin, closeThread]);

  // 非评论模式下点击 pin 打开 popup 后，点击其它区域关闭（评论模式由背景层兜底）。
  useEffect(() => {
    if (active || !openThreadId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-comment-ui]') || t.closest('[data-comment-pin]')) return;
      closeThread();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [active, openThreadId, closeThread]);

  // 点击空白背景：评论模式下落新 pin；若已有 popup/草稿则先关闭。
  const onBackdropClick = (e: React.MouseEvent) => {
    if (!active) return;
    e.stopPropagation();
    if (openThreadId) {
      closeThread();
      return;
    }
    if (draftPin) {
      setDraftPin(null);
      return;
    }
    const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setDraftPin({ x: flow.x, y: flow.y });
  };

  // ---- pin 拖动 ----
  const dragState = useRef<{
    threadId: string;
    startX: number;
    startY: number;
    grabDX: number;
    grabDY: number;
    moved: boolean;
  } | null>(null);
  const [dragOverlay, setDragOverlay] = useState<{ id: string; x: number; y: number } | null>(null);

  const onPinPointerDown = (e: React.PointerEvent, t: CanvasCommentThread) => {
    if (typeof t.x !== 'number' || typeof t.y !== 'number') return;
    e.stopPropagation();
    const anchor = toScreen(t.x, t.y);
    const layerBox = layerRef.current?.getBoundingClientRect();
    const ox = layerBox?.left ?? 0;
    const oy = layerBox?.top ?? 0;
    dragState.current = {
      threadId: t.id,
      startX: e.clientX,
      startY: e.clientY,
      // 抓取点相对 pin 锚点(屏幕)的偏移，拖动时保持。
      grabDX: e.clientX - (anchor.x + ox),
      grabDY: e.clientY - (anchor.y + oy),
      moved: false,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPinPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dist = Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY);
    if (!ds.moved && dist < DRAG_THRESHOLD) return;
    ds.moved = true;
    const layerBox = layerRef.current?.getBoundingClientRect();
    const ox = layerBox?.left ?? 0;
    const oy = layerBox?.top ?? 0;
    setDragOverlay({ id: ds.threadId, x: e.clientX - ds.grabDX - ox, y: e.clientY - ds.grabDY - oy });
  };

  const onPinPointerUp = (e: React.PointerEvent, t: CanvasCommentThread) => {
    const ds = dragState.current;
    dragState.current = null;
    if (!ds) return;
    if (!ds.moved) {
      // 视为点击：展开 popup。
      openThread(t.id);
      setDragOverlay(null);
      return;
    }
    // 落点 → flow 坐标。
    const flow = rf.screenToFlowPosition({ x: e.clientX - ds.grabDX, y: e.clientY - ds.grabDY });
    void moveThread(t.id, flow.x, flow.y);
    setDragOverlay(null);
  };

  const openThreadData = openThreadId ? positioned.find((t) => t.id === openThreadId) ?? null : null;

  // popup/草稿面板定位：放在 pin 下方（pin 在 anchor 上方，下方区域不挡 pin），
  // 水平靠近 pin 并夹进容器；下方放不下则翻到 pin 上方。
  const PIN_H = 36;
  const PANEL_H_EST = 300;
  const clampPanel = (anchorX: number, anchorY: number) => {
    const w = layerSize.w || PANEL_W + 2 * PANEL_GAP;
    const h = layerSize.h || PANEL_H_EST + 2 * PANEL_GAP;
    let left = anchorX - 24; // popup 左缘略偏 pin 左侧
    left = Math.max(PANEL_GAP, Math.min(left, w - PANEL_W - PANEL_GAP));
    const belowTop = anchorY + PANEL_GAP;
    const fitsBelow = belowTop + PANEL_H_EST <= h - PANEL_GAP;
    let top = fitsBelow ? belowTop : anchorY - PIN_H - PANEL_GAP - PANEL_H_EST;
    top = Math.max(PANEL_GAP, Math.min(top, h - 120));
    return { left, top };
  };

  const draftScreen = draftPin ? toScreen(draftPin.x, draftPin.y) : null;

  return (
    <div
      ref={layerRef}
      style={{
        position: 'absolute',
        inset: 0,
        // 评论模式下背景捕获点击以落 pin；非评论模式只让 pin 可点。
        pointerEvents: active ? 'auto' : 'none',
        zIndex: 6,
        cursor: active && !openThreadId && !draftPin ? 'crosshair' : 'default',
      }}
      onClick={onBackdropClick}
    >
      {positioned.map((t) => {
        const anchor = toScreen(t.x as number, t.y as number);
        const isDragging = dragOverlay?.id === t.id;
        const pos = isDragging ? { x: dragOverlay.x, y: dragOverlay.y } : anchor;
        const author = t.comments[0]?.author ?? null;
        const replies = t.comments.filter((c) => !c.deleted).length;
        const isOpen = openThreadId === t.id;
        return (
          <button
            key={t.id}
            data-comment-pin
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => onPinPointerDown(e, t)}
            onPointerMove={onPinPointerMove}
            onPointerUp={(e) => onPinPointerUp(e, t)}
            title={t.resolved ? '已解决的评论' : `${replies} 条评论`}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              // pin 左下角为尖端，锚点在尖端。
              transform: 'translate(0, -100%)',
              pointerEvents: 'auto',
              padding: 2,
              borderRadius: '50% 50% 50% 2px',
              border: isOpen ? '2px solid #2563eb' : '2px solid white',
              background: t.resolved ? '#94a3b8' : '#2563eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              cursor: 'pointer',
              opacity: t.resolved ? 0.7 : 1,
              touchAction: 'none',
            }}
          >
            <div style={{ position: 'relative' }}>
              <Avatar name={author?.name ?? null} url={author?.avatarUrl ?? null} size={26} />
              {t.resolved && (
                <span
                  style={{
                    position: 'absolute',
                    right: -4,
                    bottom: -4,
                    background: '#16a34a',
                    borderRadius: '50%',
                    width: 14,
                    height: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1.5px solid white',
                  }}
                >
                  <Check size={9} color="white" />
                </span>
              )}
              {!t.resolved && replies > 1 && (
                <span
                  style={{
                    position: 'absolute',
                    right: -6,
                    top: -6,
                    background: '#ef4444',
                    color: 'white',
                    borderRadius: 8,
                    minWidth: 16,
                    height: 16,
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    border: '1.5px solid white',
                  }}
                >
                  {replies}
                </span>
              )}
            </div>
          </button>
        );
      })}

      {/* 已打开的线程 popup */}
      {openThreadData &&
        typeof openThreadData.x === 'number' &&
        typeof openThreadData.y === 'number' &&
        (() => {
          const anchor = toScreen(openThreadData.x, openThreadData.y);
          const { left, top } = clampPanel(anchor.x, anchor.y);
          return (
            <div
              data-comment-ui
              style={{ position: 'absolute', left, top, pointerEvents: 'auto' }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <CommentThreadPopup
                thread={openThreadData}
                currentUserId={currentUserId}
                members={members}
                onReply={reply}
                onEdit={editComment}
                onRemove={removeComment}
                onDeleteThread={deleteThread}
                onResolve={setResolved}
                onClose={closeThread}
              />
            </div>
          );
        })()}

      {/* 新草稿 pin + composer */}
      {draftPin && draftScreen && (
        <>
          <div
            style={{
              position: 'absolute',
              left: draftScreen.x,
              top: draftScreen.y,
              transform: 'translate(0, -100%)',
              pointerEvents: 'none',
              padding: 2,
              borderRadius: '50% 50% 50% 2px',
              border: '2px dashed white',
              background: '#2563eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ width: 26, height: 26 }} />
          </div>
          {(() => {
            const { left, top } = clampPanel(draftScreen.x, draftScreen.y);
            return (
              <div
                data-comment-ui
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: PANEL_W,
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
                  padding: 10,
                  pointerEvents: 'auto',
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <CommentComposer
                  members={members}
                  placeholder="写评论…（输入 @ 提及成员）"
                  autoFocus
                  onSubmit={async (body, mentions, imageUrls) => {
                    const created = await createThread({
                      x: draftPin.x,
                      y: draftPin.y,
                      body,
                      mentions,
                      imageUrls,
                    });
                    setDraftPin(null);
                    if (created) openThread(created.id);
                  }}
                  onCancel={() => setDraftPin(null)}
                />
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default CanvasCommentLayer;
