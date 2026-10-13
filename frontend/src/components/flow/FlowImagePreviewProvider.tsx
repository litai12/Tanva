import { useCallback, useMemo, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ImagePreviewGalleryContext } from '../ui/ImagePreviewGalleryContext';
import { buildFlowPreviewGallery } from './flowPreviewGallery';

export function FlowImagePreviewProvider({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const { getNodes, getEdges } = useReactFlow();
  // Read a fresh snapshot only when a preview opens, without subscribing every
  // mounted node to every canvas drag or zoom update.
  const getImages = useCallback(() => buildFlowPreviewGallery(getNodes(), nodeId, getEdges()), [getNodes, getEdges, nodeId]);
  const value = useMemo(() => ({ currentImageId: nodeId, getImages }), [nodeId, getImages]);
  return <ImagePreviewGalleryContext.Provider value={value}>{children}</ImagePreviewGalleryContext.Provider>;
}
