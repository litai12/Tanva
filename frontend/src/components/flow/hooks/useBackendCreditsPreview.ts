export const useBackendCreditsPreview = (_params: {
  serviceType?: string | null;
  model?: string | null;
  requestParams?: Record<string, any> | null;
  outputImageCount?: number;
  enabled?: boolean;
}) => ({ credits: undefined as number | undefined, hasCredits: false });
