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

export const flowSaveService = {
  flushImageSplitInputImages,
};
