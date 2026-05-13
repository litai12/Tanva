/**
 * 2D杞?D鏈嶅姟
 * 璋冪敤鍚庣API灏?D鍥剧墖杞崲涓?D妯″瀷
 */

import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";
// 鍚庣鍩虹鍦板潃锛屽彲閫氳繃 .env 鐨?VITE_API_BASE_URL 瑕嗙洊锛岄粯璁?http://localhost:4000
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
  modelUrl: string; // 3D妯″瀷璁块棶URL (https://img.tgtai.com/view/{filename})
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
    message.includes("绉垎涓嶈冻") ||
    /insufficient\s+credits?/i.test(message) ||
    /balance.*insufficient/i.test(message)
  );
};

/**
 * 灏?D鍥剧墖杞崲涓?D妯″瀷
 */
export async function convert2Dto3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  try {
    const response = await fetchWithAuth(buildUrl("/api/ai/convert-2d-to-3d"), {
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
        ? "绉垎涓嶈冻锛?D杞?D 闇€瑕?200 绉垎锛岃鍏堝厖鍊煎悗閲嶈瘯"
        : rawErrorMessage;
      logger.error("2D to 3D conversion failed", {
        status: response.status,
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

