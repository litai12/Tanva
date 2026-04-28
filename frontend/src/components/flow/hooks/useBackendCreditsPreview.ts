import React from "react";
import {
  buildPreviewRequestSignature,
  previewCredits,
} from "@/services/creditsPreviewService";

type Params = {
  serviceType?: string | null;
  model?: string | null;
  requestParams?: Record<string, any> | null;
  outputImageCount?: number;
  enabled?: boolean;
};

export const useBackendCreditsPreview = ({
  serviceType,
  model,
  requestParams,
  outputImageCount,
  enabled = true,
}: Params) => {
  const [credits, setCredits] = React.useState<number | undefined>(undefined);
  const requestSignature = React.useMemo(() => {
    if (!enabled || !serviceType) return "";
    return buildPreviewRequestSignature({
      serviceType,
      model: model || undefined,
      requestParams: requestParams || undefined,
      outputImageCount,
    });
  }, [enabled, model, outputImageCount, requestParams, serviceType]);

  React.useEffect(() => {
    if (!enabled || !serviceType) {
      setCredits(undefined);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      previewCredits({
        serviceType,
        model: model || undefined,
        requestParams: requestParams || undefined,
        outputImageCount,
      })
        .then((result) => {
          if (cancelled) return;
          const nextCredits = Number(result?.credits);
          setCredits(Number.isFinite(nextCredits) && nextCredits > 0 ? nextCredits : undefined);
        })
        .catch(() => {
          if (cancelled) return;
          setCredits(undefined);
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, outputImageCount, requestSignature, serviceType]);

  return {
    credits,
    hasCredits: typeof credits === "number" && credits > 0,
  };
};
