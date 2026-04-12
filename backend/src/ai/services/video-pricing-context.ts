export type ManagedVideoPricingInputType =
  | 'text'
  | 'image'
  | 'video'
  | 'image_audio'
  | 'video_audio'
  | 'image_video'
  | 'image_video_audio';

export type ManagedVideoPricingContext = Record<string, unknown> & {
  resolution?: string;
  duration?: number;
  aspectRatio?: string;
  hasAudio?: boolean;
  inputType?: ManagedVideoPricingInputType;
};

const IMAGE_MODE_KEYS = new Set([
  'image',
  'first_frame',
  'last_frame',
  'start_end',
  'reference_images',
  'smart_frames',
]);

const VIDEO_MODE_KEYS = new Set([
  'video',
  'first_clip',
  'reference_video',
  'video_extend',
  'continue_video',
]);

const normalizeBooleanLike = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

const hasNonEmptyString = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const hasNonEmptyArray = (value: unknown): boolean =>
  Array.isArray(value) && value.some((item) => hasNonEmptyString(item));

export const mapRawVideoModeToInputType = (
  raw: unknown,
): ManagedVideoPricingInputType | undefined => {
  if (typeof raw !== 'string') return undefined;

  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'text' || normalized === 't2v') return 'text';
  if (normalized === 'image_audio') return 'image_audio';
  if (normalized === 'video_audio') return 'video_audio';
  if (normalized === 'image_video') return 'image_video';
  if (normalized === 'image_video_audio') return 'image_video_audio';
  if (IMAGE_MODE_KEYS.has(normalized)) return 'image';
  if (VIDEO_MODE_KEYS.has(normalized)) return 'video';
  return undefined;
};

const inferInputTypeFromAssets = (
  payload: Record<string, unknown>,
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

  if (hasImageInput && hasVideoInput && hasAudioInput) return 'image_video_audio';
  if (hasImageInput && hasVideoInput) return 'image_video';
  if (hasImageInput && hasAudioInput) return 'image_audio';
  if (hasVideoInput && hasAudioInput) return 'video_audio';
  if (hasVideoInput) return 'video';
  if (hasImageInput) return 'image';
  return undefined;
};

export const buildManagedVideoPricingContext = (
  payload: Record<string, unknown> | null | undefined,
): ManagedVideoPricingContext => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const context: ManagedVideoPricingContext = { ...source };

  if (typeof source.resolution === 'string' && source.resolution.trim()) {
    context.resolution = source.resolution.trim().toUpperCase();
  }

  const duration = Number(source.duration);
  if (Number.isFinite(duration) && duration > 0) {
    context.duration = Math.round(duration);
  }

  if (typeof source.aspectRatio === 'string' && source.aspectRatio.trim()) {
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
  if (typeof hasAudio === 'boolean') {
    context.hasAudio = hasAudio;
  }

  return context;
};
