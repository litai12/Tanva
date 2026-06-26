import type { Node, Edge } from 'reactflow';

export type NodeKind = 'textPrompt' | 'textChat' | 'textNote' | 'promptOptimize' | 'image' | 'generate' | 'generate4' | 'generatePro' | 'storyboardSplit' | 'imageSplit' | 'imageCompress' | 'audioUpload' | 'minimaxSpeech' | 'tencentSpeech' | 'minimaxMusic' | 'audioStudio';

export type TextPromptData = {
  text?: string;
  mentions?: PromptImageMention[];
  boxW?: number;
  boxH?: number;
  title?: string;
};

export type PromptMentionSource = 'flow' | 'project-library' | 'personal-library';

export type PromptImageMention = {
  id: string;
  token: string;
  label: string;
  source: PromptMentionSource;
  mediaType: 'image';
  ref: {
    nodeId?: string;
    handle?: string | null;
    historyId?: string;
    assetId?: string;
    url?: string;
    key?: string;
  };
};

const isPromptMentionSource = (value: unknown): value is PromptMentionSource =>
  value === 'flow' || value === 'project-library' || value === 'personal-library';

const isPromptMentionAsciiTokenPart = (char: string): boolean =>
  /[A-Za-z0-9_-]/.test(char);

const isPromptMentionSuffixContinuation = (char: string): boolean =>
  /[0-9_.-]/.test(char);

export const isPromptMentionTokenBoundary = (
  text: string,
  token: string,
  startIndex: number
): boolean => {
  const nextChar = text.charAt(startIndex + token.length);
  if (!nextChar) return true;
  if (isPromptMentionSuffixContinuation(nextChar)) return false;
  const lastTokenChar = token.charAt(token.length - 1);
  return !(isPromptMentionAsciiTokenPart(lastTokenChar) && isPromptMentionAsciiTokenPart(nextChar));
};

export type PromptMentionTokenMatch = {
  token: string;
  start: number;
  end: number;
};

export const findPromptMentionTokenMatches = (
  text: string,
  tokens: string[]
): PromptMentionTokenMatch[] => {
  if (!text || tokens.length === 0) return [];
  const normalizedTokens = Array.from(
    new Set(
      tokens
        .map((token) => (typeof token === 'string' ? token.trim() : ''))
        .filter((token) => token.startsWith('@'))
    )
  ).sort((a, b) => b.length - a.length);
  if (normalizedTokens.length === 0) return [];

  const matches: PromptMentionTokenMatch[] = [];
  let index = 0;
  while (index < text.length) {
    const match = normalizedTokens.find(
      (token) =>
        text.startsWith(token, index) &&
        isPromptMentionTokenBoundary(text, token, index)
    );
    if (!match) {
      index += 1;
      continue;
    }
    matches.push({
      token: match,
      start: index,
      end: index + match.length,
    });
    index += match.length;
  }
  return matches;
};

export const hasPromptMentionTokenInText = (text: string, token: string): boolean => {
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  if (!normalizedToken) return false;
  let index = text.indexOf(normalizedToken);
  while (index >= 0) {
    if (isPromptMentionTokenBoundary(text, normalizedToken, index)) return true;
    index = text.indexOf(normalizedToken, index + normalizedToken.length);
  }
  return false;
};

export const normalizePromptImageMentions = (value: unknown): PromptImageMention[] => {
  if (!Array.isArray(value)) return [];
  const out: PromptImageMention[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    const token = typeof rec.token === 'string' ? rec.token.trim() : '';
    const label = typeof rec.label === 'string' ? rec.label.trim() : token.replace(/^@/, '');
    if (!id || !token || !label || !isPromptMentionSource(rec.source)) continue;
    const refRec = rec.ref && typeof rec.ref === 'object' ? rec.ref as Record<string, unknown> : {};
    const ref = {
      nodeId: typeof refRec.nodeId === 'string' ? refRec.nodeId.trim() : undefined,
      handle: typeof refRec.handle === 'string' ? refRec.handle : undefined,
      historyId: typeof refRec.historyId === 'string' ? refRec.historyId.trim() : undefined,
      assetId: typeof refRec.assetId === 'string' ? refRec.assetId.trim() : undefined,
      url: typeof refRec.url === 'string' ? refRec.url.trim() : undefined,
      key: typeof refRec.key === 'string' ? refRec.key.trim() : undefined,
    };
    out.push({
      id,
      token,
      label,
      source: rec.source,
      mediaType: 'image',
      ref,
    });
  }
  return out;
};

export type ImageData = {
  // Base64 string (no data URL prefix)
  imageData?: string;
  // Remote URL (preferred for templates)
  imageUrl?: string;
  label?: string;
};

export type GenerateStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export type GenerateData = {
  status?: GenerateStatus;
  imageData?: string; // base64 string or remote URL
  imageUrl?: string; // remote URL (preferred for templates)
  error?: string;
  aspectRatio?: string;
  imageSize?: '0.5K' | '1K' | '2K' | '4K';
  presetPrompt?: string;
};

export type GenerateProData = {
  status?: GenerateStatus;
  imageData?: string; // base64 string or remote URL
  imageUrl?: string; // remote URL (preferred for templates)
  error?: string;
  aspectRatio?: string;
  title?: string;
  enableWebSearch?: boolean;
  prompts?: string[]; // 多个提示词，依次叠加
};

export type Generate4Data = {
  status?: GenerateStatus;
  images?: string[]; // base64 strings (up to 4)
  imageUrls?: string[]; // remote URLs (preferred for templates)
  error?: string;
  aspectRatio?: string;
  imageSize?: '0.5K' | '1K' | '2K' | '4K';
  modelProvider?: 'banana-2.5' | 'banana' | 'banana-3.1';
};

export type PromptOptimizeData = {
  text?: string; // input or selected output
  expandedText?: string; // optimized preview/output
};

export type TextChatStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export type TextChatData = {
  status?: TextChatStatus;
  responseText?: string;
  manualInput?: string;
  textChatSkillId?: string;
  enableWebSearch?: boolean;
  error?: string;
  modelProvider?: 'banana-2.5' | 'banana' | 'banana-3.1';
};

export type StoryboardSplitStatus = 'idle' | 'succeeded' | 'failed';

export type StoryboardSplitData = {
  status?: StoryboardSplitStatus;
  inputText?: string;
  segments?: string[];
  outputCount?: number; // auto from segments, max 50
  splitFormat?: string;
  error?: string;
  boxW?: number;
  boxH?: number;
};

export type ImageSplitStatus = 'idle' | 'processing' | 'succeeded' | 'failed';
export type ImageSplitMode = 'smart' | 'customGrid';

export type SplitRectItem = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SplitImageItem = {
  index: number;
  imageData: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageSplitData = {
  status?: ImageSplitStatus;
  splitMode?: ImageSplitMode;
  gridCols?: number;
  gridRows?: number;
  inputImage?: string;
  inputImageUrl?: string;
  // 方案A：持久化仅保存裁切矩形与原图引用（不保存切片图片数据）
  splitRects?: SplitRectItem[];
  sourceWidth?: number;
  sourceHeight?: number;
  // legacy：历史数据可能仍包含切片图片（将逐步迁移到 splitRects）
  splitImages?: SplitImageItem[];
  outputCount?: number;
  error?: string;
  boxW?: number;
  boxH?: number;
};

export type ImageCompressData = {
  status?: 'idle' | 'processing' | 'ready' | 'error';
  level?: 'light' | 'balanced' | 'strong';
  inputImage?: string;
  outputImage?: string;
  imageData?: string;
  originalBytes?: number;
  outputBytes?: number;
  compressionRatio?: number;
  error?: string;
  boxW?: number;
  boxH?: number;
};

export type MinimaxSpeechData = {
  status?: 'idle' | 'running' | 'succeeded' | 'failed';
  audioUrl?: string;
  error?: string;
  text?: string;
  history?: Array<{
    id: string;
    prompt: string;
    audioUrl: string;
    createdAt: number;
    voiceId?: string;
    emotion?:
      | 'happy'
      | 'sad'
      | 'angry'
      | 'fearful'
      | 'disgusted'
      | 'surprised'
      | 'calm'
      | 'fluent'
      | 'whisper';
  }>;
  selectedHistoryId?: string;
  voiceId?: string;
  model?: string;
  outputFormat?: 'hex' | 'url';
  audioMode?: 'json' | 'hex';
  emotion?:
    | 'happy'
    | 'sad'
    | 'angry'
    | 'fearful'
    | 'disgusted'
    | 'surprised'
    | 'calm'
    | 'fluent'
    | 'whisper';
  soundEffects?: Array<'spacious_echo' | 'auditorium_echo' | 'lofi_telephone' | 'robotic'>;
};

export type AudioUploadData = {
  status?: 'idle' | 'uploading' | 'ready' | 'error';
  audioUrl?: string;
  audioName?: string;
  mimeType?: string;
  duration?: number;
  error?: string;
  boxW?: number;
  boxH?: number;
};

export type TencentSpeechData = {
  status?: 'idle' | 'running' | 'succeeded' | 'failed';
  audioUrl?: string;
  videoUrl?: string;
  speakerUrl?: string;
  error?: string;
  inputVideoUrl?: string;
  text?: string;
  speakerUrlInput?: string;
  voiceId?: string;
  speakerGender?: 'male' | 'female';
  srcLang?: string;
  dstLang?: string;
  srcSubtitleUrl?: string;
  dstSubtitleUrl?: string;
  embedSubtitle?: boolean;
  font?: string;
  fontSize?: number;
  marginV?: number;
  outputPattern?: string;
  history?: Array<{
    id: string;
    prompt: string;
    audioUrl: string;
    videoUrl?: string;
    createdAt: number;
  }>;
  selectedHistoryId?: string;
};

export type AudioStudioMode =
  | 'seed-audio'
  | 'minimax-speech'
  | 'minimax-music'
  | 'tencent-dub'
  | 'upload';

export type AudioStudioHistoryItem = {
  id: string;
  prompt: string;
  audioUrl: string;
  videoUrl?: string;
  createdAt: number;
};

/**
 * 统一音频节点数据。由 `mode` 判别，并集了 4 个旧节点
 * （audioUpload / minimaxSpeech / tencentSpeech / minimaxMusic）的字段。
 */
export type AudioStudioData = {
  mode?: AudioStudioMode;
  status?: 'idle' | 'running' | 'succeeded' | 'failed' | 'uploading' | 'ready' | 'error';
  progressStartedAt?: number | string | null;
  error?: string;
  audioUrl?: string;
  videoUrl?: string;
  history?: AudioStudioHistoryItem[];
  selectedHistoryId?: string;
  boxW?: number;
  boxH?: number;

  // ---- seed-audio ----
  text?: string;
  voice?: string;
  format?: 'wav' | 'mp3' | 'pcm' | 'ogg_opus';
  sampleRate?: number;
  speechRate?: number;
  pitchRate?: number;
  loudnessRate?: number;

  // ---- minimax-speech ----
  voiceId?: string;
  model?: string;
  outputFormat?: 'hex' | 'url';
  audioMode?: 'json' | 'hex';
  emotion?:
    | 'happy'
    | 'sad'
    | 'angry'
    | 'fearful'
    | 'disgusted'
    | 'surprised'
    | 'calm'
    | 'fluent'
    | 'whisper';
  soundEffects?: Array<'spacious_echo' | 'auditorium_echo' | 'lofi_telephone' | 'robotic'>;

  // ---- minimax-music ----
  prompt?: string;
  lyrics?: string;
  isInstrumental?: boolean;
  lyricsOptimizer?: boolean;
  musicModel?: 'music-2.5+' | 'music-2.5';

  // ---- tencent-dub ----
  inputVideoUrl?: string;
  speakerUrlInput?: string;
  speakerGender?: 'male' | 'female';
  srcLang?: string;
  dstLang?: string;
  srcSubtitleUrl?: string;
  dstSubtitleUrl?: string;
  embedSubtitle?: boolean;
  font?: string;
  fontSize?: number;
  marginV?: number;
  outputPattern?: string;

  // ---- upload ----
  audioName?: string;
  mimeType?: string;
  duration?: number;
};

export type AnyNodeData = TextPromptData | PromptOptimizeData | ImageData | GenerateData | GenerateProData | Generate4Data | TextChatData | StoryboardSplitData | ImageSplitData | ImageCompressData | AudioUploadData | MinimaxSpeechData | TencentSpeechData | AudioStudioData;

export type AnyNode = Node<AnyNodeData>;
export type AnyEdge = Edge;

// 节点组类型（用于 NodeGroupWrapper 和 nodeGroupStore）
export interface NodeGroup {
  id: string;
  nodeIds: string[];
  prompts?: string[];
  aspectRatio?: string;
  createdAt: number;
}
