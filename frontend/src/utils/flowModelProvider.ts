export type FlowModelProvider = "banana-2.5" | "banana" | "banana-3.1";

export type FlowModelProviderMode = "fast" | "pro" | "ultra";

export const FLOW_MODEL_PROVIDER_SYNC_EVENT = "flow:sync-model-provider";

export const FLOW_IMAGE_REFERENCE_LIMITS: Record<FlowModelProvider, number> = {
  "banana-2.5": 3,
  banana: 11,
  "banana-3.1": 14,
};

export const normalizeFlowModelProvider = (
  value?: string | null
): FlowModelProvider => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "banana-2.5") return "banana-2.5";
  if (normalized === "banana-3.1" || normalized === "nano2") return "banana-3.1";
  if (normalized === "banana" || normalized === "gemini-pro") return "banana";
  return "banana";
};

export const resolveFlowModelProvider = (
  nodeProvider?: string | null,
  fallbackProvider?: string | null
): FlowModelProvider => {
  const local = typeof nodeProvider === "string" ? nodeProvider.trim() : "";
  if (local) return normalizeFlowModelProvider(local);
  return normalizeFlowModelProvider(fallbackProvider);
};

export const getFlowModelProviderMode = (
  provider: FlowModelProvider
): FlowModelProviderMode => {
  if (provider === "banana-2.5") return "fast";
  if (provider === "banana-3.1") return "ultra";
  return "pro";
};

export const getFlowImageReferenceLimit = (
  provider: FlowModelProvider
): number => FLOW_IMAGE_REFERENCE_LIMITS[provider] ?? FLOW_IMAGE_REFERENCE_LIMITS.banana;

export const resolveFlowImageReferenceLimit = (
  nodeProvider?: string | null,
  fallbackProvider?: string | null
): number =>
  getFlowImageReferenceLimit(
    resolveFlowModelProvider(nodeProvider, fallbackProvider)
  );
