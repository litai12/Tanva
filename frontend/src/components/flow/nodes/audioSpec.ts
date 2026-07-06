// Audio capability spec (backend-driven). Authored per registry model in
// `metadata.audioSpec` and shipped to the frontend on the audioStudio node's
// enriched `managedRoutes`. The generic `AudioSpecForm` renderer builds the node
// form from `fields`, and `FlowOverlay` builds the `/api/ai/audio/generate`
// payload from it. Every `AudioSpecField.key` MUST be an exact `AudioGenerateDto`
// field name so the collected form values map 1:1 to the payload.

import type { ManagedRouteOption } from '../managedRoutePricing';
import type { AudioStudioMode } from './audioStudioModes';

export type AudioSpecFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'number'
  | 'slider'
  | 'checkbox'
  | 'voicePicker'
  | 'tencentVoicePicker'
  | 'doubaoVoicePicker'
  | 'multiSelect';

export interface AudioSpecLocale {
  zh: string;
  en: string;
}

export interface AudioSpecFieldOption {
  value: string | number | boolean;
  label: AudioSpecLocale;
}

export interface AudioSpecField {
  /** EXACTLY an AudioGenerateDto field name → renderer output maps 1:1 to payload. */
  key: string;
  label: AudioSpecLocale;
  type: AudioSpecFieldType;
  options?: AudioSpecFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  default?: string | number | boolean | string[];
  placeholder?: AudioSpecLocale;
  required?: boolean;
  /** Optional section heading (collapsible / grouped). */
  group?: AudioSpecLocale;
  /** Simple single-equality conditional visibility. */
  visibleWhen?: { field: string; equals: unknown };
}

export interface AudioSpecEdgeInput {
  handle: 'text' | 'audio' | 'image' | 'video';
  dtoField:
    | 'text'
    | 'prompt'
    | 'referenceAudioUrls'
    | 'referenceImageUrl'
    | 'inputVideoUrl';
  /** audio refs (max 3). */
  multiple?: boolean;
  required?: boolean;
}

export interface AudioSpec {
  /** → /api/ai/audio/generate mode. */
  mode: Exclude<AudioStudioMode, 'upload'>;
  /** Which DTO field carries the concrete model id (e.g. 'model' | 'musicModel'). */
  modelField?: string;
  /** Value to send in that field (e.g. 'speech-2.6-hd', 'music-2.5+'). */
  modelValue?: string;
  fields: AudioSpecField[];
  inputs: AudioSpecEdgeInput[];
  outputs: Array<'audio' | 'video'>;
}

/** mode → default managed model key (used to default legacy/migrated nodes). */
export const MODE_DEFAULT_MODEL: Record<AudioStudioMode, string> = {
  'seed-audio': 'doubao-seed-audio-1-0',
  'minimax-speech': 'minimax-speech-2.6-hd',
  'minimax-music': 'minimax-music-2.5+',
  'tencent-dub': 'tencent-dub',
  upload: '',
};

/**
 * Read the `audioSpec` carried on an enriched managed route option (one per audio
 * model). The backend attaches `audioSpec` to each vendor entry; managedRoutePricing
 * passes it through untouched.
 */
export const getAudioSpecFromManagedRoute = (
  route?: ManagedRouteOption | null,
): AudioSpec | undefined => {
  const spec = (route as { audioSpec?: unknown } | null | undefined)?.audioSpec;
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const candidate = spec as Partial<AudioSpec>;
    if (typeof candidate.mode === 'string' && Array.isArray(candidate.fields)) {
      return candidate as AudioSpec;
    }
  }
  return undefined;
};
