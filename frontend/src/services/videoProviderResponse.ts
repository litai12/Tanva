const VIDEO_FAILURE_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "rejected",
  "cancelled",
  "canceled",
]);

const GENERIC_ERROR_MESSAGES = new Set([
  "bad request",
  "internal server error",
  "service unavailable",
  "request failed",
]);

const collectErrorMessages = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value === null || value === undefined) return [];

  if (typeof value === "string") {
    const message = value.trim();
    return message ? [message] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectErrorMessages(item, depth + 1));
  }

  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  return ["message", "error", "detail", "reason", "msg"].flatMap((key) =>
    collectErrorMessages(record[key], depth + 1)
  );
};

export const extractVideoProviderErrorMessage = (
  payload: unknown,
  fallback: string
): string => {
  const messages = Array.from(new Set(collectErrorMessages(payload)));
  const specificMessages = messages.filter(
    (message) => !GENERIC_ERROR_MESSAGES.has(message.toLowerCase())
  );
  const selected = specificMessages.length > 0 ? specificMessages : messages;
  return selected.join("; ") || fallback;
};

export const validateVideoGenerationResponse = (
  payload: unknown,
  response: { ok: boolean; status: number }
): Record<string, unknown> & { taskId: string } => {
  if (!response.ok) {
    throw new Error(
      extractVideoProviderErrorMessage(payload, `HTTP ${response.status}`)
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("视频任务创建失败：服务端返回了无效响应");
  }

  const result = payload as Record<string, unknown>;
  const status = typeof result.status === "string" ? result.status.trim().toLowerCase() : "";
  if (result.success === false || VIDEO_FAILURE_STATUSES.has(status)) {
    throw new Error(
      extractVideoProviderErrorMessage(result, "视频任务创建失败")
    );
  }

  const taskId = typeof result.taskId === "string" ? result.taskId.trim() : "";
  if (!taskId) {
    throw new Error(
      extractVideoProviderErrorMessage(
        result,
        "视频任务创建失败：未返回有效任务 ID"
      )
    );
  }

  return { ...result, taskId };
};
