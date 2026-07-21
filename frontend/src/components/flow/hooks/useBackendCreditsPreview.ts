import React from "react";
import { fetchWithAuth } from "@/services/authFetch";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000") + "/api";

export const useBackendCreditsPreview = ({
  serviceType,
  model,
  requestParams,
  outputImageCount,
  enabled = true,
}: {
  serviceType?: string | null;
  model?: string | null;
  requestParams?: Record<string, any> | null;
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

    const controller = new AbortController();
    let cancelled = false;
    setCredits(undefined);

    const timer = setTimeout(async () => {
      try {
        const body: Record<string, unknown> = { serviceType };
        if (model) body.model = model;
        if (requestParams) body.requestParams = requestParams;
        if (typeof outputImageCount === "number") body.outputImageCount = outputImageCount;

        const res = await fetchWithAuth(`${API_BASE_URL}/credits/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && typeof data?.credits === "number") {
          setCredits(data.credits);
        }
      } catch {
        // Callers must leave the quote empty; static fallbacks would create a second price source.
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, depsKey]);

  return { credits, hasCredits: typeof credits === "number" };
};
