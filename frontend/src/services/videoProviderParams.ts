import type { VideoProvider } from "./videoProviderAPI";

export type ViduModelValue =
  | "q2"
  | "q2-pro"
  | "q2-turbo"
  | "q3"
  | "q3-pro"
  | "q3-turbo"
  | "q3-mix";

export const normalizeViduModelValue = (value?: string): ViduModelValue => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (!normalized) return "q2";
  if (normalized === "q2") return "q2";
  if (normalized === "q2-pro" || normalized === "q2pro") return "q2-pro";
  if (normalized === "q2-turbo" || normalized === "q2turbo") return "q2-turbo";
  if (normalized === "q3-turbo" || normalized === "q3turbo") return "q3-turbo";
  if (normalized === "q3-mix" || normalized === "q3mix") return "q3-mix";
  if (normalized === "q3-pro" || normalized === "q3pro") return "q3-pro";
  if (normalized === "q3") return "q3";
  return normalized.startsWith("q3") ? "q3" : "q2";
};

export const normalizeViduModelForApi = (value?: string): "q2" | "q3" =>
  normalizeViduModelValue(value).startsWith("q3") ? "q3" : "q2";

export const isViduQ3FamilyModel = (value?: string): boolean =>
  normalizeViduModelForApi(value) === "q3";

export const getEffectiveViduProvider = (
  nodeData?: Pick<Record<string, any>, "viduModel">
): VideoProvider => (isViduQ3FamilyModel(nodeData?.viduModel) ? "viduq3-pro" : "vidu");

export const resolveViduVideoMode = (params: {
  hasImage2Input: boolean;
  imageCount: number;
  explicitVideoMode?: string;
}): "start-end2video" | "text2video" | "img2video" | "reference2video" => {
  const explicit = String(params.explicitVideoMode || "").trim().toLowerCase();
  if (["text", "text2video"].includes(explicit)) return "text2video";
  if (["image", "first_frame", "first-frame", "img2video"].includes(explicit)) {
    return "img2video";
  }
  if (["frame", "start_end", "start-end", "start-end2video"].includes(explicit)) {
    return "start-end2video";
  }
  if (["reference", "reference_images", "reference2video"].includes(explicit)) {
    return "reference2video";
  }
  if (params.hasImage2Input) return "start-end2video";
  if (params.imageCount === 0) return "text2video";
  if (params.imageCount === 1) return "img2video";
  if (params.imageCount === 2) return "start-end2video";
  return "reference2video";
};

export const buildViduRequestSemantics = (params: {
  rawViduModel?: string;
  hasImage2Input: boolean;
  imageCount: number;
  hasPrompt: boolean;
  explicitVideoMode?: string;
}) => {
  const requestedViduModelVariant = normalizeViduModelValue(params.rawViduModel);
  const resolvedVideoMode = resolveViduVideoMode({
    hasImage2Input: params.hasImage2Input,
    imageCount: params.imageCount,
    explicitVideoMode: params.explicitVideoMode,
  });
  const videoMode =
    requestedViduModelVariant === "q3-mix" ? "reference2video" : resolvedVideoMode;
  // Vidu Q3's reference model and q3-pro generation model are distinct VOD
  // versions. Keep the node family as q3 while sending/pricing the real variant.
  const viduModelVariant: ViduModelValue =
    requestedViduModelVariant === "q3"
      ? videoMode === "reference2video"
        ? "q3"
        : "q3-pro"
      : requestedViduModelVariant;
  const viduModel = normalizeViduModelForApi(viduModelVariant);
  return {
    provider: isViduQ3FamilyModel(viduModelVariant) ? ("viduq3-pro" as const) : ("vidu" as const),
    viduModel,
    viduModelVariant,
    isQ2ProMode: viduModelVariant === "q2-pro",
    videoMode,
  };
};
