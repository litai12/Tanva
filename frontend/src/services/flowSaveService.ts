import { imageUploadService } from '@/services/imageUploadService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import type { TemplateNode } from '@/types/template';
import { mapWithLimit } from '@/utils/asyncLimit';
import { isPersistableImageRef, normalizePersistableImageRef } from '@/utils/imageSource';

export type FlowSaveFlushResult = {
  changed: boolean;
  uploadedCount: number;
  failedCount: number;
};

const IMAGE_REF_SUFFIXES = [
  'imagedata',
  'imageurl',
  'imageurls',
  'images',
  'outputimage',
  'inputimage',
  'inputimageurl',
  'sourceimage',
  'sourceimages',
  'thumb',
  'thumbnail',
  'thumbnails',
  'thumbnaildataurl',
  'thumbnailurl',
  'poster',
  'cover',
] as const;

const isImageLikeKey = (key: string): boolean => {
  const normalized = key.toLowerCase();
  if (normalized === 'img' || normalized === 'image') return true;
  return IMAGE_REF_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(suffix)
  );
};

/**
 * Flow 保存前的图片补传：
 * - Flow 运行时允许使用 `flow-asset:`/dataURL/裸 base64 等临时引用；
 * - 但写入后端（Project.contentJson / templateData）前，必须将其替换为可持久化的远程 URL/OSS key。
 */
async function flushImageSplitInputImages(): Promise<FlowSaveFlushResult> {
  const store = useProjectContentStore.getState();
  const projectId = store.projectId;
  const content = store.content;
  if (!content?.flow?.nodes || !Array.isArray(content.flow.nodes)) {
    return { changed: false, uploadedCount: 0, failedCount: 0 };
  }

  const nodes = content.flow.nodes as TemplateNode[];
  const dir = projectId ? `projects/${projectId}/flow/images/` : 'uploads/flow/images/';

  let changed = false;
  let uploadedCount = 0;
  let failedCount = 0;

  const nextNodes: TemplateNode[] = [...nodes];

  const uploadTargets: Array<{
    index: number;
    node: TemplateNode;
    nodeId: string;
    data: Record<string, unknown>;
    candidateRaw: string;
  }> = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node || node.type !== 'imageSplit') continue;

    const nodeId = typeof node.id === 'string' && node.id ? node.id : `unknown_${i}`;
    const data = (node.data ?? {}) as Record<string, unknown>;

    const candidateRaw =
      (typeof data.inputImageUrl === 'string' && data.inputImageUrl.trim()) ||
      (typeof data.inputImage === 'string' && data.inputImage.trim()) ||
      '';
    if (!candidateRaw) continue;

    const normalized = normalizePersistableImageRef(candidateRaw);
    if (normalized && isPersistableImageRef(normalized)) {
      // 规范化代理包装（/api/assets/proxy?... -> key/url），减少落库噪声
      if (normalized !== candidateRaw) {
        nextNodes[i] = {
          ...node,
          data: { ...data, inputImageUrl: normalized, inputImage: undefined },
        };
        changed = true;
      }
      continue;
    }

    uploadTargets.push({ index: i, node, nodeId, data, candidateRaw });
  }

  if (uploadTargets.length > 0) {
    const results = await mapWithLimit(uploadTargets, 2, async (target) => {
      const uploadResult = await imageUploadService.uploadImageSource(target.candidateRaw, {
        projectId: projectId ?? undefined,
        dir,
        fileName: `image_split_${target.nodeId}_${Date.now()}.png`,
      });

      if (!uploadResult.success || !uploadResult.asset?.url) {
        return { index: target.index, ok: false as const, ref: '' };
      }

      const ref = (uploadResult.asset.key || uploadResult.asset.url).trim();
      if (!ref) {
        return { index: target.index, ok: false as const, ref: '' };
      }

      return { index: target.index, ok: true as const, ref };
    });

    results.forEach((result) => {
      if (!result.ok) {
        failedCount += 1;
        return;
      }

      const original = nodes[result.index];
      if (!original || original.type !== 'imageSplit') {
        failedCount += 1;
        return;
      }

      const data = (original.data ?? {}) as Record<string, unknown>;
      nextNodes[result.index] = {
        ...original,
        data: { ...data, inputImageUrl: result.ref, inputImage: undefined },
      };
      changed = true;
      uploadedCount += 1;
    });
  }

  if (changed) {
    store.updatePartial(
      {
        flow: {
          ...content.flow,
          nodes: nextNodes,
        },
      },
      { markDirty: true }
    );
  }

  return { changed, uploadedCount, failedCount };
}

async function flushFlowNodeImageRefs(): Promise<FlowSaveFlushResult> {
  const store = useProjectContentStore.getState();
  const projectId = store.projectId;
  const content = store.content;
  if (!content?.flow?.nodes || !Array.isArray(content.flow.nodes)) {
    return { changed: false, uploadedCount: 0, failedCount: 0 };
  }

  const dir = projectId ? `projects/${projectId}/flow/images/` : 'uploads/flow/images/';
  let changed = false;
  let uploadedCount = 0;
  let failedCount = 0;

  const uploadCache = new Map<string, string>();

  const uploadInlineRef = async (rawValue: string, nodeId: string, keyPath: string[]) => {
    const normalized = normalizePersistableImageRef(rawValue);
    if (normalized && isPersistableImageRef(normalized)) {
      return { ok: true as const, value: normalized, uploaded: false };
    }

    const cacheKey = rawValue.trim();
    const cached = uploadCache.get(cacheKey);
    if (cached) {
      return { ok: true as const, value: cached, uploaded: false };
    }

    const suffix = keyPath[keyPath.length - 1] || 'image';
    const uploadResult = await imageUploadService.uploadImageSource(rawValue, {
      projectId: projectId ?? undefined,
      dir,
      fileName: `${nodeId}_${suffix}_${Date.now()}.png`,
    });

    if (!uploadResult.success || !uploadResult.asset?.url) {
      return { ok: false as const, value: rawValue, uploaded: false };
    }

    const persisted = (uploadResult.asset.key || uploadResult.asset.url).trim();
    if (!persisted) {
      return { ok: false as const, value: rawValue, uploaded: false };
    }

    uploadCache.set(cacheKey, persisted);
    return { ok: true as const, value: persisted, uploaded: true };
  };

  const visit = async (
    value: unknown,
    nodeId: string,
    pathKeys: string[]
  ): Promise<unknown> => {
    if (typeof value === 'string') {
      const imageField = pathKeys.some((key) => isImageLikeKey(key));
      if (!imageField) return value;

      const trimmed = value.trim();
      if (!trimmed) return value;

      const result = await uploadInlineRef(trimmed, nodeId, pathKeys);
      if (!result.ok) {
        failedCount += 1;
        return value;
      }
      if (result.uploaded || result.value !== value) {
        changed = true;
        if (result.uploaded) uploadedCount += 1;
      }
      return result.value;
    }

    if (Array.isArray(value)) {
      return await mapWithLimit(
        value.map((item, index) => ({ item, index })),
        2,
        async ({ item, index }) => visit(item, nodeId, [...pathKeys, String(index)])
      );
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      const nextEntries = await mapWithLimit(
        entries.map(([key, child]) => ({ key, child })),
        2,
        async ({ key, child }) => [key, await visit(child, nodeId, [...pathKeys, key])] as const
      );
      return Object.fromEntries(nextEntries);
    }

    return value;
  };

  const nextNodes = await mapWithLimit(
    (content.flow.nodes as TemplateNode[]).map((node, index) => ({ node, index })),
    2,
    async ({ node, index }) => {
      if (!node) return node;
      const nodeId = typeof node.id === 'string' && node.id ? node.id : `unknown_${index}`;
      const nextData = await visit(node.data ?? {}, nodeId, []);
      return nextData === node.data ? node : { ...node, data: nextData as TemplateNode['data'] };
    }
  );

  if (changed) {
    store.updatePartial(
      {
        flow: {
          ...content.flow,
          nodes: nextNodes,
        },
      },
      { markDirty: true }
    );
  }

  return { changed, uploadedCount, failedCount };
}

export const flowSaveService = {
  flushFlowNodeImageRefs,
  flushImageSplitInputImages,
};
