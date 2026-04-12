export type ManagedVideoPricingInputType =
  | "text"
  | "image"
  | "video"
  | "image_audio"
  | "video_audio"
  | "image_video"
  | "image_video_audio";

export type ManagedVideoPricingDimensionKey =
  | "modelVariant"
  | "resolution"
  | "duration"
  | "inputType"
  | "hasAudio"
  | "aspectRatio";

export type ManagedVideoPricingDimensionOption = {
  value: string | number | boolean;
  labelZh: string;
  labelEn: string;
};

export type ManagedVideoPricingDimension = {
  key: ManagedVideoPricingDimensionKey;
  labelZh: string;
  labelEn: string;
  options: ManagedVideoPricingDimensionOption[];
};

const IMAGE_MODE_KEYS = new Set([
  "image",
  "first_frame",
  "last_frame",
  "start_end",
  "reference_images",
  "smart_frames",
]);

const VIDEO_MODE_KEYS = new Set([
  "video",
  "first_clip",
  "reference_video",
  "video_extend",
  "continue_video",
]);

const INPUT_TYPE_LABELS: Record<
  ManagedVideoPricingInputType,
  { zh: string; en: string }
> = {
  text: { zh: "纯文生", en: "Text Only" },
  image: { zh: "图片输入", en: "Image Input" },
  video: { zh: "视频输入", en: "Video Input" },
  image_audio: { zh: "图+音频", en: "Image + Audio" },
  video_audio: { zh: "视频+音频", en: "Video + Audio" },
  image_video: { zh: "图+视频", en: "Image + Video" },
  image_video_audio: { zh: "图+视频+音频", en: "Image + Video + Audio" },
};

const normalizeBooleanLike = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const hasNonEmptyString = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

const hasNonEmptyArray = (value: unknown): boolean =>
  Array.isArray(value) && value.some((item) => hasNonEmptyString(item));

export const mapRawVideoModeToInputType = (
  raw: unknown
): ManagedVideoPricingInputType | undefined => {
  if (typeof raw !== "string") return undefined;

  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "text" || normalized === "t2v") return "text";
  if (normalized === "image_audio") return "image_audio";
  if (normalized === "video_audio") return "video_audio";
  if (normalized === "image_video") return "image_video";
  if (normalized === "image_video_audio") return "image_video_audio";
  if (IMAGE_MODE_KEYS.has(normalized)) return "image";
  if (VIDEO_MODE_KEYS.has(normalized)) return "video";
  return undefined;
};

const inferInputTypeFromAssets = (
  payload: Record<string, unknown>
): ManagedVideoPricingInputType | undefined => {
  const hasImageInput =
    hasNonEmptyString(payload.imageUrl) ||
    hasNonEmptyString(payload.firstFrameUrl) ||
    hasNonEmptyString(payload.lastFrameUrl) ||
    hasNonEmptyString(payload.inputImageUrl) ||
    hasNonEmptyArray(payload.imageUrls) ||
    hasNonEmptyArray(payload.referenceImages) ||
    hasNonEmptyArray(payload.images);
  const hasVideoInput =
    hasNonEmptyString(payload.videoUrl) ||
    hasNonEmptyString(payload.firstClipUrl) ||
    hasNonEmptyString(payload.referenceVideoUrl) ||
    hasNonEmptyString(payload.inputVideoUrl) ||
    hasNonEmptyArray(payload.videoUrls) ||
    hasNonEmptyArray(payload.referenceVideos);
  const hasAudioInput =
    hasNonEmptyString(payload.audioUrl) ||
    hasNonEmptyString(payload.drivingAudioUrl) ||
    hasNonEmptyString(payload.inputAudioUrl) ||
    hasNonEmptyArray(payload.audioUrls);

  if (hasImageInput && hasVideoInput && hasAudioInput) return "image_video_audio";
  if (hasImageInput && hasVideoInput) return "image_video";
  if (hasImageInput && hasAudioInput) return "image_audio";
  if (hasVideoInput && hasAudioInput) return "video_audio";
  if (hasVideoInput) return "video";
  if (hasImageInput) return "image";
  return undefined;
};

export const buildManagedVideoPricingContext = (
  payload?: Record<string, unknown> | null
): Record<string, unknown> => {
  const source = payload && typeof payload === "object" ? payload : {};
  const context: Record<string, unknown> = { ...source };

  if (typeof source.resolution === "string" && source.resolution.trim()) {
    context.resolution = source.resolution.trim().toUpperCase();
  }

  const duration = Number(source.duration);
  if (Number.isFinite(duration) && duration > 0) {
    context.duration = Math.round(duration);
  }

  if (typeof source.aspectRatio === "string" && source.aspectRatio.trim()) {
    context.aspectRatio = source.aspectRatio.trim();
  }

  const inputType =
    mapRawVideoModeToInputType(source.inputType) ||
    mapRawVideoModeToInputType(source.videoMode) ||
    mapRawVideoModeToInputType(source.seedanceMode) ||
    inferInputTypeFromAssets(source);
  if (inputType) {
    context.inputType = inputType;
  }

  const hasAudio =
    normalizeBooleanLike(source.hasAudio) ??
    normalizeBooleanLike(source.generateAudio) ??
    normalizeBooleanLike(source.audioGeneration) ??
    normalizeBooleanLike(source.sound);
  if (typeof hasAudio === "boolean") {
    context.hasAudio = hasAudio;
  }

  return context;
};

export const getVideoPricingDimensions = (params: {
  modelVariants?: string[] | null;
  outputConfig?: {
    aspectRatios?: string[];
    durations?: number[];
    resolutions?: string[];
    audioGeneration?: boolean;
  } | null;
  inputModes?: string[] | null;
}): ManagedVideoPricingDimension[] => {
  const dimensions: ManagedVideoPricingDimension[] = [];
  const outputConfig = params.outputConfig || undefined;

  const modelVariants = Array.isArray(params.modelVariants)
    ? Array.from(
        new Set(
          params.modelVariants.map((item) => String(item).trim()).filter(Boolean)
        )
      )
    : [];
  if (modelVariants.length > 1) {
    dimensions.push({
      key: "modelVariant",
      labelZh: "模型档位",
      labelEn: "Model Variant",
      options: modelVariants.map((value) => ({
        value,
        labelZh: value,
        labelEn: value,
      })),
    });
  }

  const resolutions = Array.isArray(outputConfig?.resolutions)
    ? Array.from(new Set(outputConfig.resolutions.map((item) => String(item).trim().toUpperCase()).filter(Boolean)))
    : [];
  if (resolutions.length > 0) {
    dimensions.push({
      key: "resolution",
      labelZh: "分辨率",
      labelEn: "Resolution",
      options: resolutions.map((value) => ({
        value,
        labelZh: value,
        labelEn: value,
      })),
    });
  }

  const durations = Array.isArray(outputConfig?.durations)
    ? Array.from(
        new Set(
          outputConfig.durations
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0)
        )
      ).sort((a, b) => a - b)
    : [];
  if (durations.length > 0) {
    dimensions.push({
      key: "duration",
      labelZh: "时长",
      labelEn: "Duration",
      options: durations.map((value) => ({
        value,
        labelZh: `${value}秒`,
        labelEn: `${value}s`,
      })),
    });
  }

  const aspectRatios = Array.isArray(outputConfig?.aspectRatios)
    ? Array.from(new Set(outputConfig.aspectRatios.map((item) => String(item).trim()).filter(Boolean)))
    : [];
  if (aspectRatios.length > 0) {
    dimensions.push({
      key: "aspectRatio",
      labelZh: "画幅",
      labelEn: "Aspect Ratio",
      options: aspectRatios.map((value) => ({
        value,
        labelZh: value,
        labelEn: value,
      })),
    });
  }

  const inputTypes = Array.isArray(params.inputModes)
    ? Array.from(
        new Set(
          params.inputModes
            .map((item) => mapRawVideoModeToInputType(item))
            .filter((item): item is ManagedVideoPricingInputType => Boolean(item))
        )
      )
    : [];
  if (inputTypes.length > 0) {
    dimensions.push({
      key: "inputType",
      labelZh: "输入类型",
      labelEn: "Input Type",
      options: inputTypes.map((value) => ({
        value,
        labelZh: INPUT_TYPE_LABELS[value].zh,
        labelEn: INPUT_TYPE_LABELS[value].en,
      })),
    });
  }

  if (outputConfig?.audioGeneration === true) {
    dimensions.push({
      key: "hasAudio",
      labelZh: "音频",
      labelEn: "Audio",
      options: [
        { value: false, labelZh: "无声", labelEn: "Silent" },
        { value: true, labelZh: "有声", labelEn: "With Audio" },
      ],
    });
  }

  return dimensions;
};
