import type { LayerMeta } from '@/stores/layerStore';

export interface CanvasViewStateSnapshot {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ProjectContentSnapshot {
  layers: LayerMeta[];
  activeLayerId: string | null;
  canvas: CanvasViewStateSnapshot;
  paperJson?: string; // Paper.js项目序列化的JSON字符串
  updatedAt: string;
}

export function createEmptyProjectContent(): ProjectContentSnapshot {
  return {
    layers: [],
    activeLayerId: null,
    canvas: {
      zoom: 1,
      panX: 0,
      panY: 0,
    },
    updatedAt: new Date().toISOString(),
  };
}
