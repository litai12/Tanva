import type { LayerMeta } from '@/stores/layerStore';
import type { StoredImageAsset } from '@/types/canvas';
import type { Model3DData } from '@/services/model3DUploadService';

export interface ImageAssetSnapshot extends StoredImageAsset {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layerId?: string | null;
}

export interface ModelAssetSnapshot extends Model3DData {
  id: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layerId?: string | null;
}

export interface TextAssetSnapshot {
  id: string;
  content: string;
  position: { x: number; y: number };
  style: {
    fontFamily: string;
    fontWeight: 'normal' | 'bold';
    fontSize: number;
    color: string;
    align: 'left' | 'center' | 'right';
    italic: boolean;
  };
  layerId?: string | null;
}

export interface ProjectAssetsSnapshot {
  images: ImageAssetSnapshot[];
  models: ModelAssetSnapshot[];
  texts: TextAssetSnapshot[];
}

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
  meta?: {
    paperJsonLen?: number;
    layerCount?: number;
    itemCount?: number;
    savedAt?: string;
  };
  assets?: ProjectAssetsSnapshot;
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
    assets: {
      images: [],
      models: [],
      texts: [],
    },
    updatedAt: new Date().toISOString(),
  };
}
