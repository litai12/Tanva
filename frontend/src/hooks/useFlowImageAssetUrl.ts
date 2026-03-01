import React from "react";
import {
  acquireFlowImageObjectUrl,
  releaseFlowImageObjectUrl,
} from "@/services/flowImageAssetStore";

export function useFlowImageAssetUrl(assetId?: string | null): string | null {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }

    let active = true;
    setUrl(null);

    void acquireFlowImageObjectUrl(id).then((objectUrl) => {
      if (!active) {
        if (objectUrl) releaseFlowImageObjectUrl(id);
        return;
      }
      setUrl(objectUrl);
    });

    return () => {
      active = false;
      releaseFlowImageObjectUrl(id);
    };
  }, [id]);

  return url;
}

