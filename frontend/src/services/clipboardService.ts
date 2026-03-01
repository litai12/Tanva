import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot, VideoAssetSnapshot } from '@/types/project';
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
  videos: VideoAssetSnapshot[];
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

class ClipboardService {
  private canvasPayload: { data: CanvasClipboardData; timestamp: number } | null = null;
  private flowPayload: { data: FlowClipboardData; timestamp: number } | null = null;
  private activeZone: ClipboardZone | null = null;

  setCanvasData(data: CanvasClipboardData) {
    this.canvasPayload = { data, timestamp: Date.now() };
    this.activeZone = 'canvas';
  }

  setFlowData(data: FlowClipboardData) {
    this.flowPayload = { data, timestamp: Date.now() };
    this.activeZone = 'flow';
  }

  getCanvasData(): CanvasClipboardData | null {
    return this.canvasPayload?.data ?? null;
  }

  getFlowData(): FlowClipboardData | null {
    return this.flowPayload?.data ?? null;
  }

  getZone(): ClipboardZone | null {
    if (this.activeZone) return this.activeZone;
    const canvasTs = this.canvasPayload?.timestamp ?? 0;
    const flowTs = this.flowPayload?.timestamp ?? 0;
    if (!canvasTs && !flowTs) return null;
    return canvasTs >= flowTs ? 'canvas' : 'flow';
  }

  setActiveZone(zone: ClipboardZone | null) {
    this.activeZone = zone;
  }

  clear() {
    this.canvasPayload = null;
    this.flowPayload = null;
    this.activeZone = null;
  }
}

export const clipboardService = new ClipboardService();
