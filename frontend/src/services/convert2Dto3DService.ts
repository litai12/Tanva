/**
 * 2D 转 3D 服务
 * - convert2Dto3D: 旧同步接口（通用 2D->3D）
 * - convertSeed3D: 异步提交 + 轮询，避免长连接 504/524
 */

import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const SEED3D_POLL_INTERVAL_MS = 3000;
const SEED3D_POLL_TIMEOUT_MS = 15 * 60 * 1000;

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
  modelUrl: string;
  promptId?: string;
  modelKey?: string;
  error?: string;
}

type Seed3DSubmitResponse = {
  success?: boolean;
  taskId?: string;
  status?: string;
  message?: string;
  error?: string;
};

type Seed3DTaskStatusResponse = {
  success?: boolean;
  taskId?: string;
  status?: "pending" | "processing" | "succeeded" | "failed" | string;
  modelUrl?: string;
  promptId?: string;
  modelKey?: string;
  error?: string;
};

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 通用 2D -> 3D 同步接口
 */
export async function convert2Dto3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  return await convertWithEndpoint("/api/ai/convert-2d-to-3d", request);
}

/**
 * Seed3D：异步提交并轮询结果（防止代理层 504/524）
 */
export async function convertSeed3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  try {
    const submitResp = await fetchWithAuth(buildUrl("/api/ai/convert-seed3d-async"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!submitResp.ok) {
      const errorData = await submitResp.json().catch(() => ({}));
      const rawErrorMessage =
        extractApiErrorMessage(errorData) || `HTTP ${submitResp.status}`;
      const errorMessage = isInsufficientCreditsMessage(rawErrorMessage)
        ? buildInsufficientCreditsMessage("/api/ai/convert-seed3d-async")
        : rawErrorMessage;
      return {
        success: false,
        modelUrl: "",
        error: errorMessage,
      };
    }

    const submitData = (await submitResp.json()) as Seed3DSubmitResponse;
    const taskId = typeof submitData.taskId === "string" ? submitData.taskId.trim() : "";
    if (!taskId) {
      return {
        success: false,
        modelUrl: "",
        error: submitData.error || "Seed 3D 任务创建失败：缺少 taskId",
      };
    }

    const deadline = Date.now() + SEED3D_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const statusResp = await fetchWithAuth(
        buildUrl(`/api/ai/seed3d/task/${encodeURIComponent(taskId)}`),
        {
          method: "GET",
        }
      );

      if (!statusResp.ok) {
        const errorData = await statusResp.json().catch(() => ({}));
        const errorMessage =
          extractApiErrorMessage(errorData) || `HTTP ${statusResp.status}`;
        return {
          success: false,
          modelUrl: "",
          error: errorMessage,
        };
      }

      const statusData = (await statusResp.json()) as Seed3DTaskStatusResponse;
      const status = String(statusData.status || "").trim().toLowerCase();

      if (status === "succeeded" && statusData.modelUrl) {
        return {
          success: true,
          modelUrl: statusData.modelUrl,
          promptId: statusData.promptId,
          modelKey: statusData.modelKey,
        };
      }

      if (status === "failed") {
        return {
          success: false,
          modelUrl: "",
          error: statusData.error || "Seed 3D 生成失败",
        };
      }

      await sleep(SEED3D_POLL_INTERVAL_MS);
    }

    return {
      success: false,
      modelUrl: "",
      error: "Seed 3D 任务超时，请稍后在历史记录中重试",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    logger.error("Seed3D async conversion error", error);

    return {
      success: false,
      modelUrl: "",
      error: message,
    };
  }
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