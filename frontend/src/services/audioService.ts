import { fetchWithAuth } from './authFetch';
import type { AudioStudioMode } from '../components/flow/nodes/audioStudioModes';

/**
 * 统一音频生成客户端。对应后端 `POST /api/ai/audio/generate`
 * （Layer 2，DTO = AudioGenerateDto）。所有模式共用一个入口，由 `mode` 判别。
 */

export type AudioGeneratePayload = {
  mode: AudioStudioMode;
  projectId?: string;

  // seed-audio / minimax-speech 公共
  text?: string;

  // seed-audio
  voice?: string;
  format?: 'wav' | 'mp3' | 'pcm' | 'ogg_opus';
  sampleRate?: number;
  speechRate?: number;
  pitchRate?: number;
  loudnessRate?: number;
  referenceAudioUrls?: string[];
  referenceImageUrl?: string;

  // minimax-speech
  voiceId?: string;
  model?: string;
  outputFormat?: 'hex' | 'url';
  audioMode?: 'json' | 'hex';
  emotion?: string;
  soundEffects?: string[];

  // minimax-music
  prompt?: string;
  lyrics?: string;
  isInstrumental?: boolean;
  lyricsOptimizer?: boolean;
  musicModel?: string;

  // tencent-dub
  inputVideoUrl?: string;
  speakerUrl?: string;
  speakerGender?: string;
  srcLang?: string;
  dstLang?: string;
  dstLangs?: string[];
  srcSubtitleUrl?: string;
  dstSubtitleUrl?: string;
  dstSubtitleUrls?: Record<string, string>;
  embedSubtitle?: boolean;
  font?: string;
  fontSize?: number;
  marginV?: number;
  outputPattern?: string;
  notifyUrl?: string;
};

export type AudioGenerateResult = {
  audioUrl?: string;
  videoUrl?: string;
  durationSec?: number;
  mode?: string;
  provider?: string;
  requestId?: string;
};

export type DubAsyncTask = {
  taskId: string;
  status?: string;
};

const AUDIO_GENERATE_URL = '/api/ai/audio/generate';
const AUDIO_GENERATE_ASYNC_URL = '/api/ai/audio/generate/async';
const AUDIO_TASK_URL = '/api/ai/audio/task';

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const pickNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
};

const extractErrorMessage = async (
  response: Response,
  fallback: string
): Promise<string> => {
  try {
    const errorData = await response.json();
    const fromMessage = Array.isArray(errorData?.message)
      ? errorData.message.join('; ')
      : typeof errorData?.message === 'string'
      ? errorData.message.trim()
      : undefined;
    const fromError =
      typeof errorData?.error === 'string' && errorData.error.trim()
        ? errorData.error.trim()
        : undefined;
    return fromMessage || fromError || fallback;
  } catch {
    return fallback;
  }
};

const normalizeResult = (raw: any): AudioGenerateResult => ({
  audioUrl: pickString(raw?.audioUrl, raw?.audio_url, raw?.data?.audio),
  videoUrl: pickString(raw?.videoUrl, raw?.video_url),
  durationSec: pickNumber(raw?.durationSec, raw?.duration, raw?.original_duration),
  mode: typeof raw?.mode === 'string' ? raw.mode : undefined,
  provider: typeof raw?.provider === 'string' ? raw.provider : undefined,
  requestId: pickString(raw?.requestId, raw?.request_id),
});

/** 同步生成音频（seed-audio / minimax-speech / minimax-music / tencent-dub）。 */
export async function generateAudio(
  payload: AudioGeneratePayload
): Promise<AudioGenerateResult> {
  const response = await fetchWithAuth(AUDIO_GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, '音频生成失败'));
  }

  return normalizeResult(await response.json());
}

/** 创建腾讯配音异步任务，返回 taskId。 */
export async function createDubAsyncTask(
  payload: AudioGeneratePayload
): Promise<DubAsyncTask> {
  const response = await fetchWithAuth(AUDIO_GENERATE_ASYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, '创建配音任务失败'));
  }

  const raw = await response.json();
  const taskId = pickString(raw?.taskId, raw?.task_id, raw?.id);
  if (!taskId) {
    throw new Error('配音任务返回缺少 taskId');
  }
  return { taskId, status: typeof raw?.status === 'string' ? raw.status : undefined };
}

/** 查询腾讯配音异步任务结果。 */
export async function queryDubTask(
  taskId: string
): Promise<AudioGenerateResult & { status?: string }> {
  const response = await fetchWithAuth(`${AUDIO_TASK_URL}/${encodeURIComponent(taskId)}`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, '查询配音任务失败'));
  }

  const raw = await response.json();
  return {
    ...normalizeResult(raw),
    status: typeof raw?.status === 'string' ? raw.status : undefined,
  };
}

export const audioService = {
  generateAudio,
  createDubAsyncTask,
  queryDubTask,
};

export default audioService;
