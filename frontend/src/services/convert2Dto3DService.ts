/**
 * 2D 转 3D 服务
 * 通用混元 3D 与 Seed3D 均使用异步提交 + 轮询，避免长连接超时。
 */

import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const ASYNC_3D_POLL_INTERVAL_MS = 3000;
const ASYNC_3D_POLL_TIMEOUT_MS = 15 * 60 * 1000;

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
  nodeId?: string;
  clientRequestId?: string;
}

export interface Convert2Dto3DResponse {
  success: boolean;
  modelUrl: string;
  promptId?: string;
  modelKey?: string;
  error?: string;
  taskId?: string;
  status?: string;
  terminal?: boolean;
}

type Async3DSubmitResponse = {
  success?: boolean;
  taskId?: string;
  status?: string;
  message?: string;
  error?: string;
};

type Async3DTaskStatusResponse = {
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

/** 通用混元 2D -> 3D：立即提交任务并轮询结果。 */
export async function convert2Dto3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  return convertAsync3D(
    "/api/ai/convert-2d-to-3d-async",
    "/api/ai/convert-2d-to-3d/task",
    request,
    "混元 3D"
  );
}

/**
 * Seed3D：异步提交并轮询结果（防止代理层 504/524）
 */
export async function convertSeed3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  return convertAsync3D(
    "/api/ai/convert-seed3d-async",
    "/api/ai/seed3d/task",
    request,
    "Seed 3D"
  );
}

async function convertAsync3D(
  submitEndpoint: string,
  taskEndpoint: string,
  request: Convert2Dto3DRequest,
  displayName: string
): Promise<Convert2Dto3DResponse> {
  try {
    const submitResp = await fetchWithAuth(buildUrl(submitEndpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.clientRequestId
          ? { "Idempotency-Key": request.clientRequestId }
          : {}),
      },
      body: JSON.stringify(request),
    });

    if (!submitResp.ok) {
      const errorData = await submitResp.json().catch(() => ({}));
      const rawErrorMessage =
        extractApiErrorMessage(errorData) || `HTTP ${submitResp.status}`;
      const errorMessage = isInsufficientCreditsMessage(rawErrorMessage)
        ? buildInsufficientCreditsMessage(submitEndpoint)
        : rawErrorMessage;
      return {
        success: false,
        modelUrl: "",
        error: errorMessage,
        terminal: submitResp.status >= 400 && submitResp.status < 500,
      };
    }

    const submitData = (await submitResp.json()) as Async3DSubmitResponse;
    const taskId = typeof submitData.taskId === "string" ? submitData.taskId.trim() : "";
    if (!taskId) {
      return {
        success: false,
        modelUrl: "",
        error: submitData.error || `${displayName} 任务创建失败：缺少 taskId`,
        terminal: false,
      };
    }

    const deadline = Date.now() + ASYNC_3D_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const statusResp = await fetchWithAuth(
        buildUrl(`${taskEndpoint}/${encodeURIComponent(taskId)}`),
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
          taskId,
          terminal: statusResp.status >= 400 && statusResp.status < 500,
        };
      }

      const statusData = (await statusResp.json()) as Async3DTaskStatusResponse;
      const status = String(statusData.status || "").trim().toLowerCase();

      if (status === "succeeded" && statusData.modelUrl) {
        return {
          success: true,
          modelUrl: statusData.modelUrl,
          promptId: statusData.promptId,
          modelKey: statusData.modelKey,
          taskId,
          status,
          terminal: true,
        };
      }

      if (status === "failed") {
        return {
          success: false,
          modelUrl: "",
          error: statusData.error || `${displayName} 生成失败`,
          taskId,
          status,
          terminal: true,
        };
      }

      await sleep(ASYNC_3D_POLL_INTERVAL_MS);
    }

    return {
      success: false,
      modelUrl: "",
      error: `${displayName} 仍在生成，可再次点击继续等待原任务`,
      taskId,
      status: "processing",
      terminal: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    logger.error(`${displayName} async conversion error`, error);

    return {
      success: false,
      modelUrl: "",
      error: message,
      terminal: false,
    };
  }
}
