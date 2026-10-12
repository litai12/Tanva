import React from "react";
import { useBackendCreditsPreview } from "./useBackendCreditsPreview";
import { buildImageNodeCreditsPreviewConfig, type ImageNodeCreditsPreviewParams } from "@/services/imageNodeCreditsPreviewConfig";

export const useImageNodeCreditsPreview = (params: ImageNodeCreditsPreviewParams) => {
  const { aiProvider, aspectRatio, bananaImageRoute, gptImage2Quality, imageSize, managedModelKey, model, modelVersion, nodeType, platformKey, referenceImageCount, vendorKey, outputImageCount, enabled = true } = params;
  const previewConfig = React.useMemo(() => buildImageNodeCreditsPreviewConfig({ aiProvider, aspectRatio, bananaImageRoute, gptImage2Quality, imageSize, managedModelKey, model, modelVersion, nodeType, platformKey, referenceImageCount, vendorKey }), [ aiProvider, aspectRatio, bananaImageRoute, gptImage2Quality, imageSize, managedModelKey, model, modelVersion, nodeType, platformKey, referenceImageCount, vendorKey ]);

  return useBackendCreditsPreview({
    serviceType: previewConfig.serviceType,
    model: previewConfig.model,
    requestParams: previewConfig.requestParams,
    outputImageCount,
    enabled,
  });
};
