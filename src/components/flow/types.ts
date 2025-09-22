import type { Node, Edge } from 'reactflow';

export type NodeKind = 'textPrompt' | 'promptOptimize' | 'image' | 'generate' | 'generate4';

export type TextPromptData = {
  text: string;
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

export type AnyNodeData = TextPromptData | PromptOptimizeData | ImageData | GenerateData | Generate4Data;

export type AnyNode = Node<AnyNodeData>;
export type AnyEdge = Edge;
