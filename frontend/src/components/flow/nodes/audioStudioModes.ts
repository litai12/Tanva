// 统一音频节点（audioStudio）的模式配置。
// 每个模式声明其在画布上的输入/输出句柄与文案，FlowOverlay 与 AudioStudioNode 共用。

export type AudioStudioMode =
  | 'seed-audio'
  | 'minimax-speech'
  | 'minimax-music'
  | 'tencent-dub'
  | 'upload';

export type AudioStudioModeConfig = {
  key: AudioStudioMode;
  zh: string;
  en: string;
  /** 目标句柄（输入） */
  inputHandles: string[];
  /** 源句柄（输出） */
  outputHandles: string[];
  /** 积分提示（实际计费以后端为准） */
  creditsHint: number;
};

export const AUDIO_STUDIO_MODES: AudioStudioModeConfig[] = [
  {
    key: 'seed-audio',
    zh: '生成',
    en: 'Generate',
    // text 必填；audio / image 为可选参考输入
    inputHandles: ['text', 'audio', 'image'],
    outputHandles: ['audio'],
    creditsHint: 0,
  },
  {
    key: 'minimax-speech',
    zh: '语音',
    en: 'Speech',
    inputHandles: ['text'],
    outputHandles: ['audio'],
    creditsHint: 10,
  },
  {
    key: 'minimax-music',
    zh: '音乐',
    en: 'Music',
    inputHandles: ['text'],
    outputHandles: ['audio'],
    creditsHint: 30,
  },
  {
    key: 'tencent-dub',
    zh: '配音',
    en: 'Dubbing',
    inputHandles: ['text', 'video'],
    outputHandles: ['audio', 'video'],
    creditsHint: 10,
  },
  {
    key: 'upload',
    zh: '导入',
    en: 'Import',
    inputHandles: ['audio'],
    outputHandles: ['audio'],
    creditsHint: 0,
  },
];

export const AUDIO_STUDIO_MODE_KEYS: AudioStudioMode[] = AUDIO_STUDIO_MODES.map(
  (m) => m.key
);

export const DEFAULT_AUDIO_STUDIO_MODE: AudioStudioMode = 'seed-audio';

export const getAudioStudioModeConfig = (
  mode: string | undefined
): AudioStudioModeConfig => {
  const matched = AUDIO_STUDIO_MODES.find((m) => m.key === mode);
  return matched || AUDIO_STUDIO_MODES[0];
};

/** 所有模式用到的输入句柄并集（用于 FlowOverlay 句柄类型表） */
export const AUDIO_STUDIO_ALL_INPUT_HANDLES: string[] = Array.from(
  new Set(AUDIO_STUDIO_MODES.flatMap((m) => m.inputHandles))
);

/** 所有模式用到的输出句柄并集 */
export const AUDIO_STUDIO_ALL_OUTPUT_HANDLES: string[] = Array.from(
  new Set(AUDIO_STUDIO_MODES.flatMap((m) => m.outputHandles))
);
