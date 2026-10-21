export type VideoAnalysisTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export type VideoAnalysisRequest = {
  prompt: string;
  videoUrl: string;
  model: string;
  bananaImageRoute?: string;
  channelHint?: string;
  providerOptions?: Record<string, unknown>;
  projectId?: string;
};

export type VideoAnalysisTaskRequest = VideoAnalysisRequest & {
  clientRequestId: string;
  resumeTaskId?: string;
  nodeId?: string;
};

export type VideoAnalysisTask = {
  taskId: string;
  status: VideoAnalysisTaskStatus;
  progress: { completed: number; total: number };
  stage?: string;
  durationSec?: number;
  segments?: { index: number; startSec: number; endSec: number; status: string; error?: string }[];
  result?: { analysis?: string; text?: string; model?: string; analysisMode?: string };
  error?: string;
  partialAnalysis?: string;
};

export type VideoAnalysisAttempt = {
  taskId?: string;
  clientRequestId?: string;
  status?: VideoAnalysisTaskStatus;
  progress?: VideoAnalysisTask['progress'];
  error?: string;
};

export type VideoAnalysisTaskNodeData = {
  error?: string;
  analysisTaskId?: string;
  analysisTaskStatus?: VideoAnalysisTaskStatus;
  analysisTaskProgress?: VideoAnalysisTask['progress'];
  analysisTaskStage?: string;
  analysisTaskAppliedId?: string;
  analysisTaskRequest?: VideoAnalysisTaskRequest;
  analysisSubmissionState?: 'submitting' | 'unknown' | 'accepted' | 'rejected';
  analysisTaskHistory?: VideoAnalysisAttempt[];
  /** Local ownership context only; never sent in the task DTO. */
  analysisTaskTeamId?: string | null;
};

type TaskFetch = (url: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>;

export class VideoAnalysisRequestError extends Error {
  readonly submissionRejected: boolean;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VideoAnalysisRequestError';
    this.status = status;
    this.submissionRejected = [400, 401, 403, 404, 409, 413, 422].includes(status);
  }
}

/** Only an explicitly failed task with unchanged inputs can reuse its clips. */
export const videoAnalysisResumeTaskId = (
  previous: VideoAnalysisTaskNodeData,
  next: VideoAnalysisRequest,
  currentTeamId?: string | null,
): string | undefined => {
  const saved = previous.analysisTaskRequest;
  if (previous.analysisTaskStatus !== 'failed' || !previous.analysisTaskId || !saved) return undefined;
  return saved.prompt === next.prompt && saved.videoUrl === next.videoUrl &&
    saved.model === next.model && saved.bananaImageRoute === next.bananaImageRoute &&
    (saved.projectId || undefined) === (next.projectId || undefined) &&
    (previous.analysisTaskTeamId || null) === (currentTeamId || null) &&
    saved.channelHint === next.channelHint &&
    JSON.stringify(saved.providerOptions) === JSON.stringify(next.providerOptions)
    ? previous.analysisTaskId : undefined;
};

export const hasUnconfirmedVideoAnalysisSubmission = (data: VideoAnalysisTaskNodeData): boolean =>
  !data.analysisTaskId && Boolean(data.analysisTaskRequest?.clientRequestId) &&
  (data.analysisSubmissionState === 'submitting' || data.analysisSubmissionState === 'unknown');

export const videoAnalysisAttemptHistory = (data: VideoAnalysisTaskNodeData): VideoAnalysisAttempt[] => {
  const history = data.analysisTaskHistory || [];
  const clientRequestId = data.analysisTaskRequest?.clientRequestId;
  if ((!data.analysisTaskId && !clientRequestId) ||
      history.some((attempt) => clientRequestId
        ? attempt.clientRequestId === clientRequestId
        : attempt.taskId === data.analysisTaskId)) return history;
  return [...history, {
    taskId: data.analysisTaskId,
    clientRequestId,
    status: data.analysisTaskStatus,
    progress: data.analysisTaskProgress,
    error: data.error,
  }];
};

const waitForPoll = (signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, 1800);
  signal.addEventListener('abort', onAbort, { once: true });
});

export const createVideoAnalysisTaskClient = (fetchRequest: TaskFetch, apiBase: string) => {
  const endpoint = `${apiBase.replace(/\/+$/, '')}/api/ai/video-analysis-tasks`;
  const read = async (response: Response): Promise<VideoAnalysisTask> => {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = Array.isArray(payload?.message) ? payload.message.join('; ') : payload?.message;
      throw new VideoAnalysisRequestError(message || `HTTP ${response.status}`, response.status);
    }
    if (!payload || typeof payload.taskId !== 'string' || !payload.taskId.trim() ||
        !['queued', 'processing', 'succeeded', 'failed'].includes(payload.status)) {
      throw new Error('Invalid video analysis task receipt');
    }
    return payload as VideoAnalysisTask;
  };
  const get = async (taskId: string, signal?: AbortSignal): Promise<VideoAnalysisTask> => {
    const task = await read(await fetchRequest(`${endpoint}/${encodeURIComponent(taskId)}`, {
      method: 'GET', signal, timeoutMs: 20000,
    }));
    if (task.taskId !== taskId) throw new Error('Video analysis task receipt does not match the requested task');
    return task;
  };
  return {
    // Submission is deliberately single-shot. An unknown receipt is recovered
    // only by an explicit user action with the persisted clientRequestId.
    submit: async (request: VideoAnalysisTaskRequest): Promise<VideoAnalysisTask> => read(
      await fetchRequest(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), timeoutMs: 30000,
      }),
    ),
    get,
    observe: async (
      taskId: string,
      signal: AbortSignal,
      onProgress: (task: VideoAnalysisTask) => void,
      wait = waitForPoll,
    ): Promise<VideoAnalysisTask> => {
      while (!signal.aborted) {
        const task = await get(taskId, signal);
        if (signal.aborted) throw signal.reason;
        onProgress(task);
        if (task.status === 'succeeded' || task.status === 'failed') return task;
        await wait(signal);
      }
      throw signal.reason;
    },
  };
};
