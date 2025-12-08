import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot } from '@/types/project';
import type { TemplateEdge, TemplateNode } from '@/types/template';

export type ClipboardZone = 'canvas' | 'flow';

export interface PathClipboardSnapshot {
  json: any;
  layerName?: string;
  position: { x: number; y: number };
  strokeWidth?: number;
  strokeColor?: string;
  fillColor?: string;
}

export interface CanvasClipboardData {
  images: ImageAssetSnapshot[];
  models: ModelAssetSnapshot[];
  texts: TextAssetSnapshot[];
  paths: PathClipboardSnapshot[];
}

export interface ClipboardFlowNode extends TemplateNode {
  width?: number;
  height?: number;
  style?: Record<string, unknown>;
}

export interface FlowClipboardData {
  nodes: ClipboardFlowNode[];
  edges: TemplateEdge[];
  origin: { x: number; y: number };
}

type ClipboardPayload =
  | { type: 'canvas'; data: CanvasClipboardData; timestamp: number }
  | { type: 'flow'; data: FlowClipboardData; timestamp: number };

class ClipboardService {
  private payload: ClipboardPayload | null = null;
  private activeZone: ClipboardZone | null = null;

  setCanvasData(data: CanvasClipboardData) {
    this.payload = { type: 'canvas', data, timestamp: Date.now() };
    this.activeZone = 'canvas';
  }

  setFlowData(data: FlowClipboardData) {
    this.payload = { type: 'flow', data, timestamp: Date.now() };
    this.activeZone = 'flow';
  }

  getCanvasData(): CanvasClipboardData | null {
    return this.payload?.type === 'canvas' ? this.payload.data : null;
  }

  getFlowData(): FlowClipboardData | null {
    return this.payload?.type === 'flow' ? this.payload.data : null;
  }

  getZone(): ClipboardZone | null {
    return this.activeZone ?? (this.payload?.type ?? null);
  }

  setActiveZone(zone: ClipboardZone | null) {
    this.activeZone = zone;
  }

  clear() {
    this.payload = null;
    this.activeZone = null;
  }
}

export const clipboardService = new ClipboardService();
