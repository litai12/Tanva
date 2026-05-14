/**
 * 2D 转 3D 服务
 * 调用后端 API 将 2D 图片转换为 3D 模型
 */

import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";

// 后端基础地址，可通过 .env 的 VITE_API_BASE_URL 覆盖，默认 http://localhost:4000
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const buildUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

export interface Convert2Dto3DRequest {
  imageUrl?: string;
  prompt?: string;
  model?: "3.0" | "3.1";
  lowPoly?: boolean;
  sketch?: boolean;
  projectId?: string;
}

export interface Convert2Dto3DResponse {
  success: boolean;
  modelUrl: string; // 3D 模型访问 URL
  promptId?: string;
  modelKey?: string;
  error?: string;
}

const extractApiErrorMessage = (errorData: unknown): string | null => {
  if (!errorData || typeof errorData !== "object") return null;
  const data = errorData as {
    message?: unknown;
    error?: unknown;
    statusCode?: unknown;
  };

  if (typeof data.message === "string" && data.message.trim().length > 0) {
    return data.message.trim();
  }
  if (
    Array.isArray(data.message) &&
    data.message.length > 0 &&
    data.message.every((item) => typeof item === "string")
  ) {
    return data.message.join("; ");
  }
  if (typeof data.error === "string" && data.error.trim().length > 0) {
    return data.error.trim();
  }
  return null;
};

const isInsufficientCreditsMessage = (message: string): boolean => {
  if (!message) return false;
  return (
    message.includes("积分不足") ||
    message.includes("绉垎涓嶈冻") ||
    /insufficient\s+credits?/i.test(message) ||
    /balance.*insufficient/i.test(message)
  );
};

const buildInsufficientCreditsMessage = (endpoint: string): string => {
  if (endpoint.includes("convert-seed3d")) {
    return "积分不足，Seed 3D 需要 300 积分，请先充值后重试";
  }
  return "积分不足，2D转3D 需要 200 积分，请先充值后重试";
};

/**
 * 将 2D 图片转换为 3D 模型
 */
export async function convert2Dto3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  return await convertWithEndpoint("/api/ai/convert-2d-to-3d", request);
}

export async function convertSeed3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  return await convertWithEndpoint("/api/ai/convert-seed3d", request);
}

async function convertWithEndpoint(
  endpoint: string,
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  try {
    const response = await fetchWithAuth(buildUrl(endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const rawErrorMessage =
        extractApiErrorMessage(errorData) || `HTTP ${response.status}`;
      const errorMessage = isInsufficientCreditsMessage(rawErrorMessage)
        ? buildInsufficientCreditsMessage(endpoint)
        : rawErrorMessage;
      logger.error("2D to 3D conversion failed", {
        status: response.status,
        endpoint,
        error: errorMessage,
      });

      return {
        success: false,
        modelUrl: "",
        error: errorMessage,
      };
    }

    const data = await response.json();

    return {
      success: true,
      modelUrl: data.modelUrl,
      promptId: data.promptId,
      modelKey: data.modelKey,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    logger.error("2D to 3D conversion error", error);

    return {
      success: false,
      modelUrl: "",
      error: message,
    };
  }
}
