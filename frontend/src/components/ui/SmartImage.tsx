import React from "react";
import { useNonBase64ImageSrc } from "@/hooks/useNonBase64ImageSrc";
import { resolveImageToObjectUrl } from "@/utils/imageSource";
import { revokeObjectUrl } from "@/utils/objectUrlRegistry";
import { useFlowRenderMode } from "@/components/flow/FlowRenderModeContext";

export type SmartImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src"
> & {
  src?: string | null;
  placeholder?: React.ReactNode;
  disableLowDetailFallback?: boolean;
};

const SmartImage = React.forwardRef<HTMLImageElement, SmartImageProps>(
  (
    { src, placeholder, onError, disableLowDetailFallback = false, ...imgProps },
    ref
  ) => {
    const { lowDetailMode } = useFlowRenderMode();
    const shouldUseLowDetailPlaceholder =
      lowDetailMode && !disableLowDetailFallback;
    const resolvedSrc = useNonBase64ImageSrc(src, {
      suspend: shouldUseLowDetailPlaceholder,
    });
    const normalizedInput = React.useMemo(
      () => (typeof src === "string" ? src.trim() : ""),
      [src]
    );
    const [fallbackObjectUrl, setFallbackObjectUrl] = React.useState<string | null>(null);
    const fallbackReqRef = React.useRef(0);
    const fallbackUrlRef = React.useRef<string | null>(null);

    const revokeFallbackObjectUrl = React.useCallback(() => {
      const existing = fallbackUrlRef.current;
      if (!existing) return;
      fallbackUrlRef.current = null;
      revokeObjectUrl(existing);
    }, []);

    React.useEffect(() => {
      fallbackReqRef.current += 1;
      revokeFallbackObjectUrl();
      setFallbackObjectUrl(null);
    }, [normalizedInput, resolvedSrc, revokeFallbackObjectUrl]);

    React.useEffect(() => {
      if (!lowDetailMode) return;
      fallbackReqRef.current += 1;
      revokeFallbackObjectUrl();
      setFallbackObjectUrl(null);
    }, [lowDetailMode, revokeFallbackObjectUrl]);

    React.useEffect(
      () => () => {
        fallbackReqRef.current += 1;
        revokeFallbackObjectUrl();
      },
      [revokeFallbackObjectUrl]
    );

    const finalSrc = fallbackObjectUrl || resolvedSrc;

    const handleError = React.useCallback(
      (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
        if (typeof onError === "function") {
          onError(event);
        }
        if (fallbackObjectUrl) return;
        if (!normalizedInput) return;
        if (
          normalizedInput.startsWith("data:") ||
          normalizedInput.startsWith("blob:")
        ) {
          return;
        }

        const requestId = ++fallbackReqRef.current;
        void resolveImageToObjectUrl(normalizedInput, { preferProxy: true }).then(
          (objectUrl) => {
            if (!objectUrl) return;
            if (requestId !== fallbackReqRef.current) {
              revokeObjectUrl(objectUrl);
              return;
            }
            fallbackUrlRef.current = objectUrl;
            setFallbackObjectUrl(objectUrl);
          }
        );
      },
      [fallbackObjectUrl, normalizedInput, onError]
    );

    if (shouldUseLowDetailPlaceholder) {
      if (placeholder !== undefined) {
        return <>{placeholder}</>;
      }
      const placeholderStyle = {
        ...(imgProps.style as React.CSSProperties | undefined),
      };
      if (placeholderStyle.background === undefined) {
        placeholderStyle.background = "#e5e7eb";
      }
      return (
        <div
          className={
            typeof imgProps.className === "string" ? imgProps.className : undefined
          }
          style={placeholderStyle}
        />
      );
    }

    if (!finalSrc) {
      if (placeholder !== undefined) {
        return <>{placeholder}</>;
      }
      // Default placeholder: reuse className/style to keep layout stable.
      return (
        <div
          className={typeof imgProps.className === "string" ? imgProps.className : undefined}
          style={imgProps.style as React.CSSProperties | undefined}
        />
      );
    }
    return (
      <img
        ref={ref}
        {...imgProps}
        loading={imgProps.loading ?? "lazy"}
        decoding={imgProps.decoding ?? "async"}
        onError={handleError}
        src={finalSrc}
      />
    );
  }
);

SmartImage.displayName = "SmartImage";

export default SmartImage;
