import { realtimeClient } from '@/services/realtimeClient';
import { fetchWithAuth } from '@/services/authFetch';
import { useProjectStore } from '@/stores/projectStore';
import { useTeamStore } from '@/stores/teamStore';
import type { CanvasImagePatchPayload, CollabEnvelope } from './types';

/**
 * 画布图片对象的协作桥（独立于 React，供深层 canvas 钩子直接调用）。
 * - send：去抖+合并后 POST /canvas/:id/canvas-patch。
 * - 接收：订阅 realtimeClient 的 canvas_patch，去重并抑制自身后，
 *   以 window 事件 'collab:canvas-apply' 派发，由画布层监听应用，避免把 collab 句柄
 *   层层透传进 useImageTool。
 *
 * 仅同步「图片」对象；笔迹/涂鸦不走此通道。
 */

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000';

const DEBOUNCE_MS = 120;
const SEQ_WINDOW = 200;

let pending: CanvasImagePatchPayload | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;
let applyingRemote = false;
const seenSeqs: number[] = [];

function dedupById(arr?: Array<Record<string, unknown>>): Array<Record<string, unknown>> | undefined {
  if (!arr || arr.length === 0) return undefined;
  const byId = new Map<string, Record<string, unknown>>();
  const noId: Array<Record<string, unknown>> = [];
  for (const it of arr) {
    const id = it?.imageId;
    if (typeof id === 'string') byId.set(id, it);
    else noId.push(it);
  }
  return [...noId, ...byId.values()];
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  realtimeClient.subscribe((env: CollabEnvelope) => {
    if (!env || env.type !== 'canvas_patch') return;
    // 抑制自身发出的事件（后端通常已按 connId 抑制，这里再兜一层）
    if (env.senderConnId && env.senderConnId === realtimeClient.getConnId()) return;
    if (typeof env.seq === 'number') {
      if (seenSeqs.includes(env.seq)) return;
      seenSeqs.push(env.seq);
      if (seenSeqs.length > SEQ_WINDOW) seenSeqs.splice(0, seenSeqs.length - SEQ_WINDOW);
    }
    try {
      window.dispatchEvent(
        new CustomEvent('collab:canvas-apply', { detail: env.payload as CanvasImagePatchPayload }),
      );
    } catch {}
  });
}

export const collabCanvasBridge = {
  /** 画布层在应用远端 patch 期间置位，避免把远端变更又当本地变更回发。 */
  get isApplyingRemote(): boolean {
    return applyingRemote;
  },
  setApplyingRemote(v: boolean): void {
    applyingRemote = v;
  },
  /** 当前是否处于可协作状态（已连上 WS / 有 connId）。 */
  get connected(): boolean {
    return realtimeClient.getConnId() != null;
  },
  /** 确保已订阅远端 canvas_patch（幂等）。在画布挂载时调用一次即可。 */
  init(): void {
    ensureSubscribed();
  },
  /** 发送图片协作 patch（去抖+合并，按 imageId 去重保留最新）。 */
  sendImagePatch(patch: CanvasImagePatchPayload): void {
    const connId = realtimeClient.getConnId();
    if (!connId || applyingRemote) return;
    const prev = pending ?? {};
    pending = {
      upsertImages: dedupById([...(prev.upsertImages ?? []), ...(patch.upsertImages ?? [])]),
      removeImageIds: [...new Set([...(prev.removeImageIds ?? []), ...(patch.removeImageIds ?? [])])],
    };
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const toSend = pending;
      pending = null;
      if (!toSend) return;
      const projectId = useProjectStore.getState().currentProjectId;
      const teamId = useTeamStore.getState().activeTeamId;
      if (!projectId) return;
      fetchWithAuth(`${base}/api/canvas/${projectId}/canvas-patch?teamId=${teamId ?? ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: toSend, connId }),
      }).catch(() => undefined);
    }, DEBOUNCE_MS);
  },
};
