import type { ProjectContentSnapshot } from "@/types/project";
import { isPersistableImageRef } from "@/utils/imageSource";
import { FLOW_IMAGE_ASSET_PREFIX } from "@/services/flowImageAssetStore";

export function getNonRemoteImageAssetIds(
  content: ProjectContentSnapshot | null | undefined
): string[] {
  const images = content?.assets?.images ?? [];
  if (!Array.isArray(images) || images.length === 0) return [];

  const ids: string[] = [];
  for (const image of images) {
    const url = typeof image?.url === "string" ? image.url.trim() : "";
    const src = typeof image?.src === "string" ? image.src.trim() : "";
    const hasRemote = isPersistableImageRef(url) || isPersistableImageRef(src);
    if (hasRemote && !image?.pendingUpload) continue;
    if (typeof image?.id === "string" && image.id.length > 0) {
      ids.push(image.id);
    } else {
      ids.push("unknown");
    }
  }
  return ids;
}

function isPersistableDesignJsonImageRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (
    trimmed.startsWith("/api/assets/proxy") ||
    trimmed.startsWith("/assets/proxy")
  ) {
    return true;
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return true;
  }
  if (/^(templates|projects|uploads|videos)\//i.test(trimmed)) return true;
  return false;
}

function isInlineOrLocalDesignJsonImageRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("data:image/")) return true;
  if (trimmed.startsWith("blob:")) return true;
  if (trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)) return true;
  // 兜底：图片字段里出现的“非 URL/非路径”的字符串，按不允许持久化处理（通常是裸 base64）
  return !isPersistableDesignJsonImageRef(trimmed);
}

function isImageLikeKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "img" || k === "image") return true;

  // 常见图片引用字段（避免误伤 imageModel/imageSize 等配置字段）
  const imageRefSuffixes = [
    "imagedata",
    "imageurl",
    "imageurls",
    "images",
    "outputimage",
    "inputimage",
    "inputimageurl",
    "sourceimage",
    "sourceimages",
    "thumb",
    "thumbnail",
    "thumbnails",
    "thumbnaildataurl",
    "thumbnailurl",
    "poster",
    "cover",
  ];

  return imageRefSuffixes.some((suffix) => k === suffix || k.endsWith(suffix));
}

export function getNonPersistableFlowImageNodeIds(
  content: ProjectContentSnapshot | null | undefined
): string[] {
  const nodes = content?.flow?.nodes ?? [];
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const invalid = new Set<string>();

  const walk = (nodeId: string, value: unknown, pathKeys: string[]) => {
    if (invalid.has(nodeId)) return;

    if (typeof value === "string") {
      const isImageField = pathKeys.some((k) => typeof k === "string" && isImageLikeKey(k));
      if (!isImageField) return;
      if (isInlineOrLocalDesignJsonImageRef(value)) {
        invalid.add(nodeId);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(nodeId, item, [...pathKeys, String(idx)]));
      return;
    }

    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
        walk(nodeId, v, [...pathKeys, k]);
      });
    }
  };

  for (const node of nodes as Array<{ id?: string; data?: unknown }>) {
    const nodeId = typeof node?.id === "string" && node.id ? node.id : "unknown";
    walk(nodeId, node?.data, []);
  }

  return Array.from(invalid);
}

type SanitizeResult = {
  sanitized: ProjectContentSnapshot;
  dropped: {
    canvasImageIds: string[];
    flowNodeIds: string[];
  };
};

function sanitizeFlowNodeData(value: unknown, pathKeys: string[], inArray: boolean): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const isImageField = pathKeys.some((k) => typeof k === "string" && isImageLikeKey(k));
    if (!isImageField) return value;
    if (isInlineOrLocalDesignJsonImageRef(value)) {
      return inArray ? null : undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const next = value
      .map((item, idx) => sanitizeFlowNodeData(item, [...pathKeys, String(idx)], true));
    return next;
  }

  if (typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      const sanitizedChild = sanitizeFlowNodeData(v, [...pathKeys, k], false);
      if (sanitizedChild === undefined) return;
      next[k] = sanitizedChild;
    });
    return next;
  }

  return inArray ? null : undefined;
}

/**
 * 生成“可持久化”的保存快照：
 * - Canvas assets：剔除未上传/非远程图片引用（避免把 data:/blob:/base64 发到后端）
 * - Flow nodes：清理节点 data 中的本地图片字段（保留节点结构，其它字段不动）
 *
 * 注意：返回的是新对象，不会修改传入的 content。
 */
export function sanitizeProjectContentForCloudSave(
  content: ProjectContentSnapshot | null | undefined
): SanitizeResult | null {
  if (!content) return null;

  const invalidCanvasImageIds = getNonRemoteImageAssetIds(content);
  const invalidFlowNodeIds = getNonPersistableFlowImageNodeIds(content);

  const canvasInvalidSet = new Set(invalidCanvasImageIds);
  const flowInvalidSet = new Set(invalidFlowNodeIds);

  const nextAssets = content.assets
    ? {
        ...content.assets,
        images: Array.isArray(content.assets.images)
          ? content.assets.images.filter((img) => !canvasInvalidSet.has(img.id))
          : content.assets.images,
      }
    : content.assets;

  const nextFlow = content.flow
    ? {
        ...content.flow,
        nodes: Array.isArray(content.flow.nodes)
          ? content.flow.nodes.map((node) => {
              const nodeId = node.id;
              if (!flowInvalidSet.has(nodeId)) return node;
              return {
                ...node,
                data: sanitizeFlowNodeData(node.data, [], false),
              };
            })
          : content.flow.nodes,
      }
    : content.flow;

  return {
    sanitized: {
      ...content,
      assets: nextAssets,
      flow: nextFlow,
    },
    dropped: {
      canvasImageIds: invalidCanvasImageIds,
      flowNodeIds: invalidFlowNodeIds,
    },
  };
}
