import { imageUploadService } from '@/services/imageUploadService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import type { TemplateNode } from '@/types/template';
import { isPersistableImageRef, normalizePersistableImageRef } from '@/utils/imageSource';

export type FlowSaveFlushResult = {
  changed: boolean;
  uploadedCount: number;
  failedCount: number;
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

    const uploadResult = await imageUploadService.uploadImageSource(candidateRaw, {
      projectId: projectId ?? undefined,
      dir,
      fileName: `image_split_${nodeId}_${Date.now()}.png`,
    });

    if (!uploadResult.success || !uploadResult.asset?.url) {
      failedCount += 1;
      continue;
    }

    const ref = (uploadResult.asset.key || uploadResult.asset.url).trim();
    if (!ref) {
      failedCount += 1;
      continue;
    }

    nextNodes[i] = {
      ...node,
      data: { ...data, inputImageUrl: ref, inputImage: undefined },
    };
    changed = true;
    uploadedCount += 1;
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

export const flowSaveService = {
  flushImageSplitInputImages,
};
