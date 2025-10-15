import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot } from '@/types/project';
import type { TemplateEdge, TemplateNode } from '@/types/template';

export type ClipboardZone = 'canvas' | 'flow';

export interface PathClipboardSnapshot {
  json: any;
  layerName?: string;
  position: { x: number; y: number };
}

export interface CanvasClipboardData {
  images: ImageAssetSnapshot[];
  models: ModelAssetSnapshot[];
  texts: TextAssetSnapshot[];
  paths: PathClipboardSnapshot[];
}

export interface FlowClipboardData {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
  origin: { x: number; y: number };
}

type ClipboardPayload =
  | { type: 'canvas'; data: CanvasClipboardData; timestamp: number }
  | { type: 'flow'; data: FlowClipboardData; timestamp: number };

class ClipboardService {
  private payload: ClipboardPayload | null = null;

  setCanvasData(data: CanvasClipboardData) {
    this.payload = { type: 'canvas', data, timestamp: Date.now() };
  }

  setFlowData(data: FlowClipboardData) {
    this.payload = { type: 'flow', data, timestamp: Date.now() };
  }

  getCanvasData(): CanvasClipboardData | null {
    return this.payload?.type === 'canvas' ? this.payload.data : null;
  }

  getFlowData(): FlowClipboardData | null {
    return this.payload?.type === 'flow' ? this.payload.data : null;
  }

  getZone(): ClipboardZone | null {
    return this.payload?.type ?? null;
  }

  clear() {
    this.payload = null;
  }
}

export const clipboardService = new ClipboardService();

