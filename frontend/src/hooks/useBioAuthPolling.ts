import React from "react";
import { getBioAuthStatus, type BioAuthStatus } from "../services/bioAuthAPI";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export interface BioAuthPollingOptions {
  taskId?: string;
  status?: BioAuthStatus;
  onUpdate: (next: { status: BioAuthStatus; errorMessage?: string }) => void;
}

/**
 * status === 'processing' 时自动轮询至 terminal；其他状态不工作。
 * 超时强制置 failed。
 */
export function useBioAuthPolling({ taskId, status, onUpdate }: BioAuthPollingOptions) {
  const onUpdateRef = React.useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  React.useEffect(() => {
    if (!taskId || status !== "processing") return;
    let cancelled = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await getBioAuthStatus(taskId);
        if (cancelled) return;
        if (result.status === "processing") {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            onUpdateRef.current({ status: "failed", errorMessage: "认证超时，请重试" });
            return;
          }
          setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          onUpdateRef.current({ status: result.status, errorMessage: result.errorMessage });
        }
      } catch (err: any) {
        if (cancelled) return;
        onUpdateRef.current({ status: "failed", errorMessage: err?.message || "轮询失败" });
      }
    };

    const t = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [taskId, status]);
}
