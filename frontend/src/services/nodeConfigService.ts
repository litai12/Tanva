/**
 * 节点配置服务
 * 从后端获取节点配置，用于动态控制节点面板显示
 */
import { getApiBaseUrl } from "../utils/assetProxy";

export interface NodeConfig {
  nodeKey: string;
  nameZh: string;
  nameEn: string;
  category: "input" | "image" | "video" | "other";
  status: "normal" | "maintenance" | "coming_soon" | "disabled";
  statusMessage?: string;
  creditsPerCall: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder: number;
  description?: string;
  metadata?: Record<string, any>;
}

// 缓存配置
let cachedConfigs: NodeConfig[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

/**
 * 获取所有节点配置
 */
export async function fetchNodeConfigs(): Promise<NodeConfig[]> {
  // 检查缓存
  if (cachedConfigs && Date.now() - cacheTimestamp < CACHE_TTL) {
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
      return "维护中";
    case "coming_soon":
      return "即将开放";
    case "disabled":
      return "已禁用";
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
    { nodeKey: "textNote", nameZh: "文本便签", nameEn: "Note", category: "input", status: "normal", sortOrder: 6, creditsPerCall: 0 },
    { nodeKey: "camera", nameZh: "相机节点", nameEn: "Camera", category: "input", status: "normal", sortOrder: 7, creditsPerCall: 0 },

    // 生图节点
    { nodeKey: "generate", nameZh: "生成节点", nameEn: "Generate", category: "image", status: "normal", sortOrder: 10, creditsPerCall: 10 },
    { nodeKey: "generate4", nameZh: "四图生成", nameEn: "Generate 4", category: "image", status: "normal", sortOrder: 11, creditsPerCall: 40 },
    { nodeKey: "generatePro", nameZh: "高级生成", nameEn: "Generate Pro", category: "image", status: "normal", sortOrder: 12, creditsPerCall: 30 },
    { nodeKey: "generatePro4", nameZh: "高级四图", nameEn: "Generate Pro 4", category: "image", status: "normal", sortOrder: 13, creditsPerCall: 120 },
    { nodeKey: "generateReference", nameZh: "参考生成", nameEn: "Reference", category: "image", status: "normal", sortOrder: 14, creditsPerCall: 30 },
    { nodeKey: "midjourney", nameZh: "Midjourney", nameEn: "Midjourney", category: "image", status: "normal", sortOrder: 15, creditsPerCall: 20 },

    // 视频生成节点
    { nodeKey: "klingVideo", nameZh: "Kling视频生成", nameEn: "Kling", category: "video", status: "maintenance", sortOrder: 20, creditsPerCall: 60 },
    { nodeKey: "kling26Video", nameZh: "Kling 2.6视频生成", nameEn: "Kling 2.6", category: "video", status: "normal", sortOrder: 21, creditsPerCall: 100 },
    { nodeKey: "klingO1Video", nameZh: "Kling O1视频生成", nameEn: "Kling O1", category: "video", status: "normal", sortOrder: 22, creditsPerCall: 100 },
    { nodeKey: "viduVideo", nameZh: "Vidu视频生成", nameEn: "Vidu", category: "video", status: "normal", sortOrder: 23, creditsPerCall: 60 },
    { nodeKey: "doubaoVideo", nameZh: "豆包视频生成", nameEn: "Doubao", category: "video", status: "normal", sortOrder: 24, creditsPerCall: 60 },
    { nodeKey: "sora2Video", nameZh: "Sora视频生成", nameEn: "Sora", category: "video", status: "normal", sortOrder: 25, creditsPerCall: 40 },
    { nodeKey: "wan26", nameZh: "Wan2.6视频", nameEn: "Wan2.6", category: "video", status: "normal", sortOrder: 26, creditsPerCall: 600 },
    { nodeKey: "wan2R2V", nameZh: "Wan2参考视频", nameEn: "Wan2 R2V", category: "video", status: "normal", sortOrder: 27, creditsPerCall: 600 },

    // 其他节点
    { nodeKey: "videoAnalyze", nameZh: "视频分析节点", nameEn: "Video Analysis", category: "other", status: "normal", sortOrder: 30, creditsPerCall: 30 },
    { nodeKey: "videoFrameExtract", nameZh: "视频帧提取", nameEn: "Frame Extract", category: "other", status: "normal", sortOrder: 31, creditsPerCall: 0 },
    { nodeKey: "analysis", nameZh: "图像分析节点", nameEn: "Analysis", category: "other", status: "normal", sortOrder: 32, creditsPerCall: 6 },
    { nodeKey: "promptOptimize", nameZh: "提示词优化", nameEn: "Optimize", category: "other", status: "normal", sortOrder: 33, creditsPerCall: 2 },
    { nodeKey: "textChat", nameZh: "文字对话", nameEn: "Chat", category: "other", status: "normal", sortOrder: 34, creditsPerCall: 2 },
    { nodeKey: "storyboardSplit", nameZh: "分镜拆解", nameEn: "Storyboard", category: "other", status: "normal", sortOrder: 35, creditsPerCall: 10 },
    { nodeKey: "imageGrid", nameZh: "图片拼接", nameEn: "Grid", category: "other", status: "normal", sortOrder: 36, creditsPerCall: 0 },
    { nodeKey: "imageSplit", nameZh: "图片拆分", nameEn: "Split", category: "other", status: "normal", sortOrder: 37, creditsPerCall: 0 },
    { nodeKey: "three", nameZh: "2D转3D", nameEn: "2D to 3D", category: "other", status: "normal", sortOrder: 38, creditsPerCall: 30 },
  ];
}
