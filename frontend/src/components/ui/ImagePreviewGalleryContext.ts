import { createContext } from 'react';

export interface ImagePreviewCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface PreviewGalleryImage {
  id: string;
  src: string;
  title?: string;
  timestamp?: number;
  crop?: ImagePreviewCrop;
}

/** Optional host adapter; standalone previews retain their supplied collections. */
export const ImagePreviewGalleryContext = createContext<{
  currentImageId: string;
  getImages: () => PreviewGalleryImage[];
} | null>(null);
