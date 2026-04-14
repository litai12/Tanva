import React from "react";

export const useNodeRunCredits = (credits?: number | string | null) =>
  React.useMemo(() => {
    const value = Number(credits);
    const normalized = Number.isFinite(value) && value > 0 ? value : undefined;
    return {
      credits: normalized,
      hasCredits: typeof normalized === "number" && normalized > 0,
    };
  }, [credits]);

