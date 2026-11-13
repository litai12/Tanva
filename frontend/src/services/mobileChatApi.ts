// 移动端 /m：会话（/api/mobile-chat）与成片任务（/api/video-productions）。
import { fetchWithAuth, type AuthFetchInit } from "./authFetch";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

export type MobileAttachment = { type: "image" | "video"; url: string; name?: string };
export type MobileMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "job" | "image" | "image_set" | "error";
  content: string;
  attachments: MobileAttachment[];
  jobId: string | null;
  status: "done" | "streaming" | "error";
  createdAt: string;
  /** kind=image 时的目标画幅。 */
  aspectRatio?: string;
  generationStartedAt?: string;
  submitError?: string;
  /** kind=image_set：详情页各屏与拼好的长图。 */
  imageSet?: ImageSetMeta;
};
export type ImageSetMeta = {
  title: string; aspectRatio: string;
  sections: Array<{ title: string; taskId: string | null; error?: string; startedAt?: string }>;
  longImageUrl?: string | null;
};
export type ImageTask = { status: "queued" | "processing" | "succeeded" | "failed"; imageUrl: string | null; error: string | null };
export type MobileConversation = { id: string; title: string; lastMessageAt: string };
export type StepStatus = "pending" | "submitted" | "succeeded" | "failed";
export type StepCount = { total: number; succeeded: number; running: number; failed: number };
export type VideoJob = {
  jobId: string;
  mode: "film" | "remake" | "single";
  status: string;
  stage: "planning" | "waiting_credits" | "producing" | "composing" | "succeeded" | "failed" | "cancelled";
  error: string | null;
  finalVideoUrl: string | null;
  progress: { images: StepCount; clips: StepCount };
  estimate: { credits: number | null; balance?: number | null; partial?: boolean } | null;
  storyboard: Array<{
    index: number; key: string; title: string; durationSeconds: number; prompt: string; references: string[];
    aspectRatio?: string; status?: StepStatus; startedAt?: string | null; videoUrl: string | null; error: string | null;
  }> | null;
  images: Array<{ key: string; title: string; status?: StepStatus; imageUrl: string | null; error: string | null }>;
  /** 规划阶段 TapCanvas 节点进度（nodeSummary 为各状态计数）。 */
  planProgress?: { status: string; nodes: Array<{ label: string; status: string }>; nodeSummary: Record<string, number> | null; elapsedMs: number | null };
  warnings: string[];
  totalSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type VideoJobSummary = {
  jobId: string; kind: string; status: string; stage: string; finalVideoUrl: string | null; prompt: string; createdAt: string;
};

async function call<T>(path: string, init?: AuthFetchInit): Promise<T> {
  const res = await fetchWithAuth(`${API_BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.message;
    throw new Error(Array.isArray(msg) ? msg.join("；") : typeof msg === "string" ? msg : `请求失败（${res.status}）`);
  }
  return body as T;
}

export const mobileChatApi = {
  list: () => call<MobileConversation[]>("/mobile-chat/conversations"),
  create: () => call<MobileConversation>("/mobile-chat/conversations", { method: "POST", body: "{}" }),
  get: (id: string) => call<MobileConversation & { messages: MobileMessage[] }>(`/mobile-chat/conversations/${id}`),
  rename: (id: string, title: string) =>
    call<{ ok: true }>(`/mobile-chat/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  remove: (id: string) => call<{ ok: true }>(`/mobile-chat/conversations/${id}`, { method: "DELETE" }),

  job: (id: string) => call<VideoJob>(`/video-productions/${id}`),
  jobs: () => call<VideoJobSummary[]>("/video-productions?limit=50"),
  produce: (id: string) => call<VideoJob>(`/video-productions/${id}/produce`, { method: "POST", body: "{}" }),
  retry: (id: string, clipKeys?: string[]) =>
    call<VideoJob>(`/video-productions/${id}/retry`, { method: "POST", body: JSON.stringify(clipKeys ? { clipKeys } : {}) }),
  cancel: (id: string) => call<VideoJob>(`/video-productions/${id}/cancel`, { method: "POST", body: "{}" }),
  balance: () => call<{ balance: number }>("/credits/balance"),
  stitch: (messageId: string) => call<MobileMessage>(`/mobile-chat/messages/${messageId}/stitch`, { method: "POST", body: "{}", timeoutMs: 180_000 }),
  retryImage: (messageId: string, taskId: string | null, sectionIndex?: number) =>
    call<MobileMessage>(`/mobile-chat/messages/${messageId}/retry-image`, {
      method: "POST", body: JSON.stringify({ taskId, sectionIndex }), timeoutMs: 90_000,
    }),
  imageTask: (id: string) => call<ImageTask>(`/ai/image-task/${encodeURIComponent(id)}`),

  /** 发送一条消息，按 SSE 事件回调；网络断开时服务端仍会跑完本轮。 */
  async send(
    conversationId: string,
    payload: { text: string; attachments: MobileAttachment[] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE 帧按事件名分派，由调用方收窄
    onEvent: (event: string, data: any) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/api/mobile-chat/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
      timeoutMs: 0,
      signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null);
      const msg = body?.message;
      const err = new Error(Array.isArray(msg) ? msg.join("；") : typeof msg === "string" ? msg : `发送失败（${res.status}）`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        if (!data.length) continue;
        try { onEvent(event, JSON.parse(data.join("\n"))); } catch { /* 忽略坏帧 */ }
      }
    }
  },
};
