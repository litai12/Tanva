import React from "react";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { dataUrlToBlob } from "@/utils/imageConcurrency";
import { toRenderableImageSrc } from "@/utils/imageSource";

const BASE64_MAGIC_MIME: Array<{ prefix: string; mime: string }> = [
  { prefix: "iVBORw0KGgo", mime: "image/png" },
  { prefix: "/9j/", mime: "image/jpeg" },
  { prefix: "R0lGOD", mime: "image/gif" },
  { prefix: "UklGR", mime: "image/webp" },
  { prefix: "PHN2Zy", mime: "image/svg+xml" },
];

const guessMimeTypeFromBase64 = (base64: string): string => {
  const compact = base64.replace(/\s+/g, "");
  const hit = BASE64_MAGIC_MIME.find((it) => compact.startsWith(it.prefix));
  return hit?.mime || "image/png";
};

const looksLikeBase64 = (value: string): boolean => {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 1024) {
    // 小字符串容易误判，除非命中已知魔数
    return BASE64_MAGIC_MIME.some((it) => compact.startsWith(it.prefix));
  }
  if (compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
};

const isBase64DataImageUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!/^data:image\//i.test(trimmed)) return false;
  return /;base64,/i.test(trimmed);
};

const normalizeBareBase64ToDataUrl = (value: string): string | null => {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return null;
  if (!looksLikeBase64(compact)) return null;
  const mime = guessMimeTypeFromBase64(compact);
  return `data:${mime};base64,${compact}`;
};

/**
 * 用于 UI 渲染的图片 src：
 * - remote/key/proxy/path -> 直接可渲染（必要时走 proxy）
 * - flow-asset -> 转为 objectURL
 * - data:image;base64 / 裸 base64 -> 转为 Blob + objectURL（避免 <img src=data:...> 的大字符串驻留）
 *
 * 注意：objectURL 仅运行时有效，禁止持久化。
 */
export function useNonBase64ImageSrc(input?: string | null): string | null {
  const raw = typeof input === "string" ? input.trim() : "";

  const flowAssetId = React.useMemo(() => parseFlowImageAssetRef(raw), [raw]);
  const flowObjectUrl = useFlowImageAssetUrl(flowAssetId);

  const resolvedByImageSource = React.useMemo(() => {
    if (!raw) return null;
    if (flowAssetId) return null;
    if (raw.startsWith("data:") || raw.startsWith("blob:")) return null;
    return toRenderableImageSrc(raw);
  }, [flowAssetId, raw]);

  const inferredBase64DataUrl = React.useMemo(() => {
    if (!resolvedByImageSource) return false;
    if (raw.startsWith("data:") || raw.startsWith("blob:")) return false;
    return isBase64DataImageUrl(resolvedByImageSource);
  }, [raw, resolvedByImageSource]);

  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);

  const revokeObjectUrl = React.useCallback(() => {
    const existing = objectUrlRef.current;
    if (!existing) return;
    objectUrlRef.current = null;
    try {
      URL.revokeObjectURL(existing);
    } catch {}
  }, []);

  const needsInlineConversion = React.useMemo(() => {
    if (!raw) return false;
    if (flowAssetId) return false;
    if (raw.startsWith("blob:")) return false;
    if (raw.startsWith("data:")) return isBase64DataImageUrl(raw);
    return looksLikeBase64(raw) || inferredBase64DataUrl;
  }, [flowAssetId, inferredBase64DataUrl, raw]);

  const nonInlineRenderable = React.useMemo(() => {
    if (!raw) return null;
    if (flowAssetId) return null;
    if (needsInlineConversion) return null;
    if (raw.startsWith("blob:")) return raw;
    if (raw.startsWith("data:")) return raw; // 非 base64 的 data:（例如 svg utf8）保留
    return resolvedByImageSource || raw;
  }, [flowAssetId, needsInlineConversion, raw, resolvedByImageSource]);

  React.useEffect(() => {
    if (!raw) {
      revokeObjectUrl();
      setObjectUrl(null);
      return;
    }

    if (flowAssetId) {
      revokeObjectUrl();
      setObjectUrl(null);
      return;
    }

    if (!needsInlineConversion) {
      revokeObjectUrl();
      setObjectUrl(null);
      return;
    }

    let cancelled = false;
    revokeObjectUrl();
    setObjectUrl(null);

    void (async () => {
      try {
        const dataUrl =
          raw.startsWith("data:")
            ? raw
            : normalizeBareBase64ToDataUrl(raw) ||
              (inferredBase64DataUrl ? resolvedByImageSource : null);
        if (!dataUrl) return;
        const blob = await dataUrlToBlob(dataUrl);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
      } catch {
        // ignore: will render placeholder by returning null
      }
    })();

    return () => {
      cancelled = true;
      revokeObjectUrl();
    };
  }, [
    flowAssetId,
    inferredBase64DataUrl,
    needsInlineConversion,
    raw,
    revokeObjectUrl,
    resolvedByImageSource,
  ]);

  if (flowAssetId) return flowObjectUrl;
  return objectUrl || nonInlineRenderable;
}
