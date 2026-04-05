/**
 * 节点配置服务
 * 从后端获取节点配置，用于动态控制节点面板显示
 */
import { getApiBaseUrl } from "../utils/assetProxy";
import { pickLocaleText } from "@/utils/localeText";

export interface NodeConfig {
  nodeKey: string;
  nameZh: string;
  nameEn: string;
  category: "input" | "image" | "video" | "audio" | "other";
  status: "normal" | "maintenance" | "coming_soon" | "disabled";
  statusMessage?: string;
  creditsPerCall: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder: number;
  description?: string;
  metadata?: Record<string, any>;
}

const buildVodNodeMetadata = (
  base: Record<string, any>,
  vod: Record<string, any>,
  options?: {
    nodeKind?: string;
    upstreamDomain?: string;
  }
): Record<string, any> => ({
  ...base,
  nodeKind: options?.nodeKind || "vod_video_generation",
  routeStrategy: "model_management_v2",
  upstreamDomain: options?.upstreamDomain || "vod.tencentcloudapi.com",
  vod,
});

// 缓存配置
let cachedConfigs: NodeConfig[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

/** 跨标签页通知画布刷新节点配置（与 localStorage 事件 key 一致） */
export const NODE_CONFIG_SYNC_STORAGE_KEY = "tanva:nodeConfigRev";

/** 同窗口内通知（storage 事件不会在写入的当前标签页触发） */
export const NODE_CONFIG_SYNC_DOM_EVENT = "tanva:nodeConfigsUpdated";

/**
 * 管理端更新节点配置后调用：清空内存缓存并通知其他标签页重新拉取
 */
export function notifyNodeConfigsUpdated(): void {
  clearNodeConfigCache();
  try {
    localStorage.setItem(NODE_CONFIG_SYNC_STORAGE_KEY, String(Date.now()));
  } catch {
    // 隐私模式等场景忽略
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NODE_CONFIG_SYNC_DOM_EVENT));
  }
}

/**
 * 获取所有节点配置
 * @param options.force 为 true 时跳过内存缓存（管理端保存后、收到同步通知时使用）
 */
export async function fetchNodeConfigs(options?: {
  force?: boolean;
}): Promise<NodeConfig[]> {
  const force = Boolean(options?.force);
  if (!force && cachedConfigs && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedConfigs;
  }

  try {
    const apiBaseUrl = getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/api/public/ai/node-configs`);

    if (!response.ok) {
      console.warn("获取节点配置失败，使用默认配置");
      return getDefaultConfigs();
    }

    const configs = await response.json();

    // 更新缓存
    cachedConfigs = configs;
    cacheTimestamp = Date.now();

    return configs;
  } catch (error) {
    console.warn("获取节点配置出错，使用默认配置:", error);
    return getDefaultConfigs();
  }
}

/**
 * 清除缓存（用于管理员更新配置后刷新）
 */
export function clearNodeConfigCache() {
  cachedConfigs = null;
  cacheTimestamp = 0;
}

/**
 * 获取状态对应的 badge 文本
 */
export function getStatusBadge(status: string): string | undefined {
  switch (status) {
    case "maintenance":
      return pickLocaleText("维护中", "Maintenance");
    case "coming_soon":
      return pickLocaleText("即将开放", "Coming Soon");
    case "disabled":
      return pickLocaleText("已禁用", "Disabled");
    default:
      return undefined;
  }
}

/**
 * 默认配置（后端不可用时的降级方案）
 */
function getDefaultConfigs(): NodeConfig[] {
  return [
    // 输入节点
    { nodeKey: "textPrompt", nameZh: "提示词节点", nameEn: "Prompt", category: "input", status: "normal", sortOrder: 1, creditsPerCall: 0 },
    { nodeKey: "textPromptPro", nameZh: "高级提示词", nameEn: "Prompt Pro", category: "input", status: "normal", sortOrder: 2, creditsPerCall: 0 },
    { nodeKey: "image", nameZh: "图片节点", nameEn: "Image", category: "input", status: "normal", sortOrder: 3, creditsPerCall: 0 },
    { nodeKey: "imagePro", nameZh: "高级图片节点", nameEn: "Image Pro", category: "input", status: "normal", sortOrder: 4, creditsPerCall: 0 },
    { nodeKey: "video", nameZh: "视频节点", nameEn: "Video", category: "input", status: "normal", sortOrder: 5, creditsPerCall: 0 },
    { nodeKey: "textNote", nameZh: "文本便签", nameEn: "Note Node", category: "input", status: "normal", sortOrder: 6, creditsPerCall: 0 },
    { nodeKey: "camera", nameZh: "相机节点", nameEn: "Camera", category: "input", status: "normal", sortOrder: 7, creditsPerCall: 0 },

    // 生图节点
    { nodeKey: "generate", nameZh: "生成节点", nameEn: "Generate", category: "image", status: "normal", sortOrder: 10, creditsPerCall: 10 },
    { nodeKey: "generate4", nameZh: "四图生成", nameEn: "Generate 4", category: "image", status: "normal", sortOrder: 11, creditsPerCall: 120 },
    { nodeKey: "generatePro", nameZh: "自定义节点", nameEn: "Agent", category: "image", status: "normal", sortOrder: 12, creditsPerCall: 30 },
    { nodeKey: "generatePro4", nameZh: "高级四图", nameEn: "Generate Pro 4", category: "image", status: "normal", sortOrder: 13, creditsPerCall: 120 },
    { nodeKey: "generateReference", nameZh: "参考生成", nameEn: "Reference", category: "image", status: "normal", sortOrder: 14, creditsPerCall: 30 },
    { nodeKey: "viewAngle", nameZh: "视角变换", nameEn: "View Angle", category: "image", status: "normal", sortOrder: 15, creditsPerCall: 30 },
    { nodeKey: "midjourney", nameZh: "Midjourney", nameEn: "Midjourney", category: "image", status: "normal", sortOrder: 16, creditsPerCall: 50 },
    { nodeKey: "nano2", nameZh: "Nano2生成", nameEn: "Nano2", category: "image", status: "normal", sortOrder: 17, creditsPerCall: 30 },

    // 视频生成节点
    // { nodeKey: "klingVideo", nameZh: "Kling视频生成", nameEn: "Kling", category: "video", status: "maintenance", sortOrder: 20, creditsPerCall: 600 },
    { nodeKey: "kling26Video", nameZh: "Kling 2.6视频生成", nameEn: "Kling 2.6", category: "video", status: "normal", sortOrder: 21, creditsPerCall: 600, metadata: buildVodNodeMetadata({ type: "kling26Video", provider: "kling", modelKeys: ["kling-2.6"], supportedModels: ["kling-v2-6"], defaultData: { provider: "kling", klingModel: "kling-v2-6", mode: "std", sound: true, audioUrls: [], clipDuration: 5 } }, { label: "VOD Kling 2.6", modelName: "Kling", modelVersion: "2.6", outputConfig: { aspectRatios: ["16:9", "9:16", "1:1"], durations: [5, 10], resolutions: ["720P", "1080P"], audioGeneration: true }, inputModes: ["text", "image", "start_end"], notes: ["Kling 2.6 首尾帧模式仅建议在静音场景下使用"] }) },
    { nodeKey: "kling30Video", nameZh: "Kling 3.0视频生成", nameEn: "Kling 3.0", category: "video", status: "normal", sortOrder: 22, creditsPerCall: 600, metadata: buildVodNodeMetadata({ type: "klingVideo", provider: "kling", modelKeys: ["kling-3.0"], supportedModels: ["kling-v3-0"], defaultData: { provider: "kling", klingModel: "kling-v3-0", mode: "std", sound: true, audioUrls: [], clipDuration: 5 } }, { label: "VOD Kling 3.0", modelName: "Kling", modelVersion: "3.0", outputConfig: { aspectRatios: ["16:9", "9:16", "1:1"], durations: [5, 10], resolutions: ["720P", "1080P"], audioGeneration: true }, inputModes: ["text", "image"], notes: ["该节点参数按腾讯 VOD AIGC 文档约束展示"] }) },
    {
      nodeKey: "klingO1Video", nameZh: "Kling 3.0-Omni视频生成", nameEn: "Kling 3.0-Omni", category: "video", status: "normal", sortOrder: 23, creditsPerCall: 1600,
      metadata: buildVodNodeMetadata({ type: "klingO1Video", provider: "kling-o3", modelKeys: ["kling-o3"], supportedModels: ["kling-o3"], defaultData: { provider: "kling-o3", mode: "std", clipDuration: 5 } }, { label: "VOD Kling 3.0-Omni", modelName: "Kling", modelVersion: "3.0-Omni", outputConfig: { aspectRatios: ["16:9", "9:16", "1:1"], durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ["720P", "1080P"], audioGeneration: true }, inputModes: ["text", "image", "reference_video"], notes: ["当前接入优先覆盖文生视频和图片参考模式"] })
    },
    {
      nodeKey: "viduVideo", nameZh: "Vidu Q2视频生成", nameEn: "Vidu Q2", category: "video", status: "normal", sortOrder: 24, creditsPerCall: 600,
      metadata: buildVodNodeMetadata({ type: "viduVideo", provider: "vidu", modelKeys: ["vidu-q2"], supportedModels: ["q2"], defaultData: { provider: "vidu", viduModel: "q2", resolution: "720p", clipDuration: 5 } }, { label: "VOD Vidu Q2", modelName: "Vidu", modelVersion: "q2", outputConfig: { aspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"], durations: [1, 2, 3, 4, 5, 6, 7, 8], resolutions: ["540P", "720P", "1080P"] }, inputModes: ["text", "image"] })
    },
    {
      nodeKey: "viduQ2TurboVideo", nameZh: "Vidu Q2-Turbo视频生成", nameEn: "Vidu Q2-Turbo", category: "video", status: "normal", sortOrder: 25, creditsPerCall: 600,
      metadata: buildVodNodeMetadata({ type: "viduVideo", provider: "vidu", modelKeys: ["vidu-q2-turbo"], supportedModels: ["q2-turbo"], defaultData: { provider: "vidu", viduModel: "q2-turbo", resolution: "720p", clipDuration: 5 } }, { label: "VOD Vidu Q2-Turbo", modelName: "Vidu", modelVersion: "q2-turbo", outputConfig: { aspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"], durations: [1, 2, 3, 4, 5, 6, 7, 8], resolutions: ["540P", "720P", "1080P"] }, inputModes: ["text", "image", "start_end"], notes: ["支持 LastFrameUrl 首尾帧模式"] })
    },
    {
      nodeKey: "viduQ2ProVideo", nameZh: "Vidu Q2-Pro视频生成", nameEn: "Vidu Q2-Pro", category: "video", status: "normal", sortOrder: 26, creditsPerCall: 600,
      metadata: buildVodNodeMetadata({ type: "viduVideo", provider: "vidu", modelKeys: ["vidu-q2-pro"], supportedModels: ["q2-pro"], defaultData: { provider: "vidu", viduModel: "q2-pro", resolution: "720p", clipDuration: 5 } }, { label: "VOD Vidu Q2-Pro", modelName: "Vidu", modelVersion: "q2-pro", outputConfig: { aspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"], durations: [1, 2, 3, 4, 5, 6, 7, 8], resolutions: ["540P", "720P", "1080P"] }, inputModes: ["text", "image", "start_end"], notes: ["支持 LastFrameUrl 首尾帧模式"] })
    },
    {
      nodeKey: "viduQ3", nameZh: "Vidu Q3 Pro视频生成", nameEn: "Vidu Q3 Pro", category: "video", status: "normal", sortOrder: 27, creditsPerCall: 800,
      metadata: buildVodNodeMetadata({ type: "viduQ3", provider: "viduq3-pro", modelKeys: ["vidu-q3"], supportedModels: ["q3", "q3-pro", "q3-turbo"], defaultData: { provider: "viduq3-pro", viduModel: "q3", resolution: "720p", clipDuration: 8 } }, { label: "VOD Vidu Q3", modelName: "Vidu", modelVersion: "q3", outputConfig: { aspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"], durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolutions: ["540P", "720P", "1080P"] }, inputModes: ["text", "image"] })
    },
    {
      nodeKey: "viduQ3MixVideo", nameZh: "Vidu Q3-Mix视频生成", nameEn: "Vidu Q3-Mix", category: "video", status: "normal", sortOrder: 28, creditsPerCall: 800,
      metadata: buildVodNodeMetadata({ type: "viduQ3", provider: "viduq3-pro", modelKeys: ["vidu-q3-mix"], supportedModels: ["q3-mix"], defaultData: { provider: "viduq3-pro", viduModel: "q3-mix", resolution: "720p", clipDuration: 8 } }, { label: "VOD Vidu Q3-Mix", modelName: "Vidu", modelVersion: "q3-mix", outputConfig: { aspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"], durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolutions: ["540P", "720P", "1080P"] }, inputModes: ["reference"], notes: ["Q3-Mix 仅支持 Reference 模式，至少需要 1 张参考图"] })
    },
    {
      nodeKey: "doubaoVideo", nameZh: "Seedance 1.5 Pro视频生成", nameEn: "Seedance 1.5 Pro", category: "video", status: "normal", sortOrder: 29, creditsPerCall: 600,
      metadata: buildVodNodeMetadata({ type: "doubaoVideo", provider: "doubao", modelKeys: ["seedance-1.5"], supportedModels: ["seedance-1.5-pro"], defaultData: { provider: "doubao", seedanceModel: "seedance-1.5-pro", clipDuration: 5, resolution: "720P" } }, { label: "Ark Seedance 1.5-Pro", modelName: "Seedance", modelVersion: "1.5-pro", outputConfig: { aspectRatios: ["16:9", "9:16", "1:1"], durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ["720P"] }, inputModes: ["text", "image"], notes: ["1.5-Pro 当前接入默认分辨率限制为 720P"] }, { nodeKind: "ark_video_generation", upstreamDomain: "ark.cn-beijing.volces.com" })
    },
    {
      nodeKey: "seedance20Video", nameZh: "Seedance 2.0视频生成", nameEn: "Seedance 2.0", category: "video", status: "normal", sortOrder: 30, creditsPerCall: 600,
      metadata: buildVodNodeMetadata({ type: "doubaoVideo", provider: "doubao", modelKeys: ["seedance-2.0"], supportedModels: ["seedance-2.0"], defaultData: { provider: "doubao", seedanceModel: "seedance-2.0", clipDuration: 5, resolution: "720P" } }, { label: "Ark Seedance 2.0", modelName: "Seedance", modelVersion: "2.0", outputConfig: { aspectRatios: ["16:9", "9:16", "1:1"], durations: [3, 4, 5, 6, 7, 8, 9, 10], resolutions: ["720P", "1080P"] }, inputModes: ["text", "image"], notes: ["当前接入模型 ID: doubao-seedance-2-0-260128"] }, { nodeKind: "ark_video_generation", upstreamDomain: "ark.cn-beijing.volces.com" })
    },
    {
      nodeKey: "sora2Video", nameZh: "Sora2 Pro视频生成", nameEn: "Sora2 Pro", category: "video", status: "normal", sortOrder: 31, creditsPerCall: 40,
      metadata: { type: "sora2Video", provider: "sora2", modelKeys: ["sora-2"], supportedModels: ["sora-2", "sora-2-pro"], defaultData: { generationType: "sora2", model: "sora-2-pro", clipDuration: 10, aspectRatio: "16:9", watermark: false, thumbnailEnabled: true, privateMode: false, storyboard: false } }
    },
    { nodeKey: "sora2Character", nameZh: "Sora2角色生成", nameEn: "Sora2 Character", category: "video", status: "normal", sortOrder: 32, creditsPerCall: 0 },
    { nodeKey: "wan26", nameZh: "Wan2.6视频", nameEn: "Wan2.6", category: "video", status: "normal", sortOrder: 33, creditsPerCall: 600 },
    { nodeKey: "wan2R2V", nameZh: "Wan2参考视频", nameEn: "Wan2 R2V", category: "video", status: "normal", sortOrder: 34, creditsPerCall: 600 },

    // 其他节点
    { nodeKey: "videoAnalyze", nameZh: "视频分析节点", nameEn: "Video Analysis", category: "other", status: "normal", sortOrder: 31, creditsPerCall: 30 },
    { nodeKey: "videoFrameExtract", nameZh: "视频帧提取", nameEn: "Frame Extract", category: "other", status: "normal", sortOrder: 32, creditsPerCall: 0 },
    { nodeKey: "analysis", nameZh: "图像分析节点", nameEn: "Analysis", category: "other", status: "normal", sortOrder: 33, creditsPerCall: 20 },
    { nodeKey: "promptOptimize", nameZh: "提示词优化", nameEn: "Optimize", category: "other", status: "normal", sortOrder: 34, creditsPerCall: 10 },
    { nodeKey: "textChat", nameZh: "文字对话", nameEn: "Chat", category: "other", status: "normal", sortOrder: 35, creditsPerCall: 10 },
    { nodeKey: "storyboardSplit", nameZh: "分镜拆解", nameEn: "Storyboard", category: "other", status: "normal", sortOrder: 36, creditsPerCall: 10 },
    { nodeKey: "imageGrid", nameZh: "图片拼接", nameEn: "Grid", category: "other", status: "normal", sortOrder: 37, creditsPerCall: 0 },
    { nodeKey: "imageSplit", nameZh: "图片拆分", nameEn: "Split", category: "other", status: "normal", sortOrder: 38, creditsPerCall: 0 },
    { nodeKey: "imageCompress", nameZh: "图片压缩", nameEn: "Image Compress", category: "other", status: "normal", sortOrder: 39, creditsPerCall: 0 },
    { nodeKey: "three", nameZh: "2D转3D", nameEn: "2D to 3D", category: "other", status: "normal", sortOrder: 40, creditsPerCall: 200 },
    { nodeKey: "audioUpload", nameZh: "语音节点", nameEn: "Audio Node", category: "audio", status: "normal", sortOrder: 41, creditsPerCall: 0 },
    { nodeKey: "minimaxSpeech", nameZh: "MiniMax语音合成", nameEn: "MiniMax Speech", category: "audio", status: "normal", sortOrder: 42, creditsPerCall: 10, serviceType: "minimax-speech" },
    { nodeKey: "videoToGif", nameZh: "视频转GIF", nameEn: "Video to GIF", category: "other", status: "normal", sortOrder: 43, creditsPerCall: 30, serviceType: "video-to-gif", priceYuan: 0.3 },
    { nodeKey: "tencentSpeech", nameZh: "腾讯语音合成", nameEn: "Tencent Speech", category: "audio", status: "normal", sortOrder: 44, creditsPerCall: 10, serviceType: "tencent-speech" },
    { nodeKey: "minimaxMusic", nameZh: "MiniMax音乐生成", nameEn: "MiniMax Music", category: "audio", status: "normal", sortOrder: 45, creditsPerCall: 30, serviceType: "minimax-music" },
  ];
}
