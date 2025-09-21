import type { Node, Edge } from 'reactflow';

export type NodeKind = 'textPrompt' | 'promptOptimize' | 'image' | 'generate';

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

export type PromptOptimizeData = {
  text?: string; // input or selected output
  expandedText?: string; // optimized preview/output
};

export type AnyNodeData = TextPromptData | PromptOptimizeData | ImageData | GenerateData;

export type AnyNode = Node<AnyNodeData>;
export type AnyEdge = Edge;
