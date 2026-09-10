// The canvas exposes one GPT Image 2.5 model. Normalize saved legacy variants.
export function normalizeCanvasGptImage25Model(model: string, nodeConfigKey?: string): string {
  return ["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(model) ||
    ["gptImage25", "gptImage25Flare", "gptImage25Sunburst"].includes(nodeConfigKey || "")
    ? "gpt-image-2.5" : model;
}

export type GptImageModelOption = {
  model: string;
  nodeConfigKey: string;
  nodeConfigNameZh: string;
  nodeConfigNameEn: string;
  nodeConfigMetadata?: Record<string, unknown>;
  creditsPerCall: number;
  vendorKey?: string;
  platformKey?: string;
  enabled: boolean;
};

// Switch the complete routing identity: a stale gptImage25 key would otherwise
// normalize an explicit GPT Image 2 selection back to 2.5 at execution time.
export function buildGptImageModelSwitchPatch(option: GptImageModelOption) {
  if (!option.enabled) return null;
  return {
    model: option.model,
    managedModelKey: option.model,
    modelProvider: "nano2",
    nodeConfigKey: option.nodeConfigKey,
    nodeConfigNameZh: option.nodeConfigNameZh,
    nodeConfigNameEn: option.nodeConfigNameEn,
    nodeConfigMetadata: option.nodeConfigMetadata,
    creditsPerCall: option.creditsPerCall,
    vendorKey: option.vendorKey,
    platformKey: option.platformKey,
    maxReferenceImages: option.nodeConfigMetadata?.maxReferenceImages ?? null,
    quality: option.model === "gpt-image-2.5" ? "max" : "auto",
    error: undefined,
  };
}
