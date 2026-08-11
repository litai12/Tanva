export type Seedance25OmniReferenceTaskType =
  | "auto"
  | "reference"
  | "edit"
  | "extend";

const SEEDANCE25_ALIASES = new Set([
  "seedance-2.5",
  "seedance-2-5",
  "doubao-seedance-2-5",
  "doubao-seedance-2-5-260628",
  "doubao-seedance-2.5",
  "2.5",
]);

export const resolveSeedance25OmniReferenceTaskType = (input: {
  seedanceModel: unknown;
  seedanceMode: unknown;
  referenceImageCount?: number;
  referenceVideoCount?: number;
  referenceAudioCount?: number;
}): Seedance25OmniReferenceTaskType | undefined => {
  const model = typeof input.seedanceModel === "string"
    ? input.seedanceModel.trim().toLowerCase()
    : "";
  if (!SEEDANCE25_ALIASES.has(model)) return undefined;

  const mode = typeof input.seedanceMode === "string"
    ? input.seedanceMode.trim().toLowerCase()
    : "";
  if (mode === "video_editing") return "edit";
  if (mode === "video_extend") return "extend";
  if (mode === "video_reference") return "reference";

  const referenceCount =
    Math.max(0, Number(input.referenceImageCount) || 0) +
    Math.max(0, Number(input.referenceVideoCount) || 0) +
    Math.max(0, Number(input.referenceAudioCount) || 0);
  if (
    referenceCount > 0 &&
    ["reference", "reference_images", "smart_frames"].includes(mode)
  ) {
    return "reference";
  }
  return undefined;
};

export const resolveSeedanceBillingDurations = (input: {
  taskType?: Seedance25OmniReferenceTaskType;
  requestedOutputDurationSec: number;
  inputVideoDurationSec: number;
}): {
  outputDurationSec: number;
  inputVideoDurationSec: number;
  billingDurationSec: number;
} => {
  const requestedOutputDurationSec =
    Number.isFinite(input.requestedOutputDurationSec) && input.requestedOutputDurationSec > 0
      ? input.requestedOutputDurationSec
      : 0;
  const inputVideoDurationSec =
    Number.isFinite(input.inputVideoDurationSec) && input.inputVideoDurationSec > 0
      ? input.inputVideoDurationSec
      : 0;
  // Ark uses duration=-1 for editing, but pricing must use the real output length.
  // Editing output follows the input video, then both processed durations are charged.
  const outputDurationSec =
    input.taskType === "edit" && inputVideoDurationSec > 0
      ? inputVideoDurationSec
      : requestedOutputDurationSec;

  return {
    outputDurationSec: Number(outputDurationSec.toFixed(3)),
    inputVideoDurationSec: Number(inputVideoDurationSec.toFixed(3)),
    billingDurationSec: Number((outputDurationSec + inputVideoDurationSec).toFixed(3)),
  };
};
