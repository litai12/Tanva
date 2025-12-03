import type { Node, Edge } from 'reactflow';

export type NodeKind = 'textPrompt' | 'textChat' | 'textNote' | 'promptOptimize' | 'image' | 'generate' | 'generate4' | 'generatePro' | 'storyboardSplit';

export type TextPromptData = {
  text?: string;
  boxW?: number;
  boxH?: number;
  title?: string;
};

export type ImageData = {
  // Base64 string (no data URL prefix)
  imageData?: string;
  label?: string;
};

export type GenerateStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export type GenerateData = {
  status?: GenerateStatus;
  imageData?: string; // base64 string
  error?: string;
  aspectRatio?: string;
  presetPrompt?: string;
};

export type GenerateProData = {
  status?: GenerateStatus;
  imageData?: string; // base64 string
  error?: string;
  aspectRatio?: string;
  prompts?: string[]; // 多个提示词，依次叠加
};

export type Generate4Data = {
  status?: GenerateStatus;
  images?: string[]; // up to 4
  count?: number; // 1..4
  error?: string;
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
  enableWebSearch?: boolean;
  error?: string;
};

export type StoryboardSplitStatus = 'idle' | 'succeeded' | 'failed';

export type StoryboardSplitData = {
  status?: StoryboardSplitStatus;
  inputText?: string;
  segments?: string[];
  outputCount?: number; // default 9, max 20
  error?: string;
  boxW?: number;
  boxH?: number;
};

export type AnyNodeData = TextPromptData | PromptOptimizeData | ImageData | GenerateData | GenerateProData | Generate4Data | TextChatData | StoryboardSplitData;

export type AnyNode = Node<AnyNodeData>;
export type AnyEdge = Edge;
