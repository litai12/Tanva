/**
 * seed-audio（豆包）富音色目录服务
 * 从后端公开接口拉取火山引擎 seed-tts-2.0 在线音色（含头像 + 试听链接），
 * 内存缓存；失败/为空时回落到静态 DOUBAO_SEED_AUDIO_VOICES（无头像/试听）。
 */
import { getApiBaseUrl } from "../utils/assetProxy";
import { DOUBAO_SEED_AUDIO_VOICES } from "../components/flow/nodes/doubaoSeedAudioVoices";

export interface SeedAudioVoice {
  id: string;
  name: string;
  avatar: string;
  trialUrl: string;
  gender: string;
  age: string;
  scene: string;
  description: string;
}

let cached: SeedAudioVoice[] | null = null;
let cacheTimestamp = 0;
let inflight: Promise<SeedAudioVoice[]> | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

/** 静态库映射成统一形状（无头像/试听） */
function staticFallback(): SeedAudioVoice[] {
  return DOUBAO_SEED_AUDIO_VOICES.map((v) => ({
    id: v.id,
    name: v.name,
    avatar: "",
    trialUrl: "",
    gender: "",
    age: "",
    scene: v.scene,
    description: v.lang || "",
  }));
}

function normalize(raw: any): SeedAudioVoice | null {
  const id = typeof raw?.id === "string" ? raw.id : "";
  if (!id) return null;
  return {
    id,
    name: typeof raw.name === "string" && raw.name ? raw.name : id,
    avatar: typeof raw.avatar === "string" ? raw.avatar : "",
    trialUrl: typeof raw.trialUrl === "string" ? raw.trialUrl : "",
    gender: typeof raw.gender === "string" ? raw.gender : "",
    age: typeof raw.age === "string" ? raw.age : "",
    scene: typeof raw.scene === "string" && raw.scene ? raw.scene : "通用场景",
    description: typeof raw.description === "string" ? raw.description : "",
  };
}

/**
 * 拉取动态音色目录；失败或为空回落静态库。
 */
export async function fetchSeedAudioVoices(): Promise<SeedAudioVoice[]> {
  if (cached && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cached;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const apiBaseUrl = getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/api/public/ai/seed-audio-voices`);
      if (!response.ok) {
        return staticFallback();
      }
      const json = await response.json();
      const list: SeedAudioVoice[] = Array.isArray(json?.voices)
        ? json.voices.map(normalize).filter((v: SeedAudioVoice | null): v is SeedAudioVoice => v !== null)
        : [];
      if (list.length === 0) {
        return staticFallback();
      }
      cached = list;
      cacheTimestamp = Date.now();
      return list;
    } catch {
      return staticFallback();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
