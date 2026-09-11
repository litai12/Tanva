import type { NodeConfig } from "./nodeConfigService";

export const GPT_IMAGE_25_MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const LEGACY_MODELS: Record<string, string> = {
  gptImage25: "gpt-image-2.5-flare",
  gptImage25Flare: "gpt-image-2.5-flare",
  gptImage25Sunburst: "gpt-image-2.5-sunburst",
};

// Preserve active saved variants; migrate the retired base model to Flare.
export function normalizeCanvasGptImage25Model(model: string, nodeConfigKey?: string, fallback = ""): string {
  const selected = model.trim() || LEGACY_MODELS[nodeConfigKey || ""] || fallback;
  return selected === "gpt-image-2.5" ? "gpt-image-2.5-flare" : selected;
}

export function expandGptImageModelConfigs(configs: NodeConfig[]): NodeConfig[] {
  return configs.filter((config) => ["gptImage2", "gptImage25"].includes(config.nodeKey)).flatMap((config) => {
    const models = config.nodeKey === "gptImage25" ? GPT_IMAGE_25_MODELS : ["gpt-image-2"];
    return models.map((model) => {
      const metadata = config.metadata || {};
      // Never reuse the default variant's vendor/pricing for a different model.
      const managedRoutes = metadata.managedRoutesByModel?.[model] ||
        (metadata.managedRoutes?.modelKey === model ? metadata.managedRoutes : undefined);
      return {
        ...config,
        nameZh: config.nodeKey === "gptImage25" ? model : config.nameZh,
        nameEn: config.nodeKey === "gptImage25" ? model : config.nameEn,
        metadata: { ...metadata, model, managedModelKey: model, managedRoutes,
          defaultData: { ...metadata.defaultData, model, managedModelKey: model, quality: model === "gpt-image-2.5" ? "max" : undefined } },
      };
    });
  });
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

// Switch the complete routing identity and remove quality values from other variants.
export function buildGptImageModelSwitchPatch(option: GptImageModelOption) {
  if (!option.enabled || option.model === "gpt-image-2.5") return null;
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
    quality: option.model === "gpt-image-2.5" ? "max" : option.model === "gpt-image-2" ? "auto" : undefined,
    error: undefined,
  };
}
