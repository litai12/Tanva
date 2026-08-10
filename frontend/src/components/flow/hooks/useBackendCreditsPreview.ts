import React from "react";
import { fetchWithAuth } from "@/services/authFetch";
import { SharedRequestPool } from "@/utils/sharedRequestPool";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000") + "/api";

const PREVIEW_REQUEST_TIMEOUT_MS = 12000;
const creditsPreviewPool = new SharedRequestPool<number>({
  maxConcurrent: 6,
  ttlMs: 60_000,
  maxEntries: 256,
});

const requestCreditsPreview = async (
  body: Record<string, unknown>,
): Promise<number | undefined> => {
  const requestKey = JSON.stringify(body);
  return creditsPreviewPool.request(requestKey, async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      PREVIEW_REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/credits/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestKey,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Credits preview failed with HTTP ${res.status}`);
      }
      const data = await res.json();
      if (typeof data?.credits !== "number") {
        throw new Error("Credits preview response did not include credits");
      }
      return data.credits;
    } finally {
      window.clearTimeout(timeout);
    }
  });
};

export const useBackendCreditsPreview = ({
  serviceType,
  model,
  requestParams,
  outputImageCount,
  enabled = true,
}: {
  serviceType?: string | null;
  model?: string | null;
  requestParams?: Record<string, unknown> | null;
  outputImageCount?: number;
  enabled?: boolean;
}) => {
  const [credits, setCredits] = React.useState<number | undefined>(undefined);

  const depsKey = React.useMemo(
    () =>
      JSON.stringify({ serviceType, model, requestParams, outputImageCount }),
    [serviceType, model, requestParams, outputImageCount],
  );

  React.useEffect(() => {
    if (!enabled || !serviceType) {
      setCredits(undefined);
      return;
    }

    let cancelled = false;
    setCredits(undefined);

    const timer = setTimeout(async () => {
      try {
        const body: Record<string, unknown> = { serviceType };
        if (model) body.model = model;
        if (requestParams) body.requestParams = requestParams;
        if (typeof outputImageCount === "number") body.outputImageCount = outputImageCount;

        const nextCredits = await requestCreditsPreview(body);
        if (!cancelled && typeof nextCredits === "number") {
          setCredits(nextCredits);
        }
      } catch {
        // Callers must leave the quote empty; static fallbacks would create a second price source.
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, depsKey]);

  return { credits, hasCredits: typeof credits === "number" };
};
