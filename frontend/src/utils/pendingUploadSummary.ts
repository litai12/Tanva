import { useProjectContentStore } from '@/stores/projectContentStore';
import { getInFlightUploadCount } from '@/stores/uploadTaskStore';
import { getNonPersistableFlowImageNodeIds, getNonRemoteImageAssetIds } from '@/utils/projectContentValidation';
import type { PendingUploadSummary } from '@/stores/uploadLeavePromptStore';
import { isPersistableImageRef, normalizePersistableImageRef } from '@/utils/imageSource';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function getPendingRuntimeImageIds(): string[] {
  if (typeof window === 'undefined') return [];
  const win = window as unknown as { tanvaImageInstances?: unknown };
  const instances = Array.isArray(win.tanvaImageInstances) ? win.tanvaImageInstances : [];
  if (!Array.isArray(instances) || instances.length === 0) return [];

  const ids: string[] = [];
  for (let i = 0; i < instances.length; i += 1) {
    const instance = instances[i];
    const instanceRecord = asRecord(instance);
    const rawId = instanceRecord?.id;
    const imageId =
      (typeof rawId === 'string' && rawId.trim())
        ? rawId.trim()
        : `unknown_runtime_${i}`;
    const data = asRecord(instanceRecord?.imageData);
    if (!data) continue;

    const rawUrl = typeof data.url === 'string' ? data.url.trim() : '';
    const rawSrc = typeof data.src === 'string' ? data.src.trim() : '';
    const rawKey = typeof data.key === 'string' ? data.key.trim() : '';

    const normalizedUrl = rawUrl ? normalizePersistableImageRef(rawUrl) : '';
    const normalizedSrc = rawSrc ? normalizePersistableImageRef(rawSrc) : '';
    const normalizedKey = rawKey ? normalizePersistableImageRef(rawKey) : '';

    const persistedRef =
      (normalizedKey && isPersistableImageRef(normalizedKey) ? normalizedKey : '') ||
      (normalizedUrl && isPersistableImageRef(normalizedUrl) ? normalizedUrl : '') ||
      (normalizedSrc && isPersistableImageRef(normalizedSrc) ? normalizedSrc : '');

    const localDataUrl = typeof data.localDataUrl === 'string' ? data.localDataUrl : '';
    const fallback = localDataUrl || rawUrl || rawSrc;
    const ref = persistedRef || fallback;
    if (!ref) continue;

    const normalizedRef = normalizePersistableImageRef(ref) || ref;
    const pendingUpload = Boolean(data.pendingUpload);
    const pending = pendingUpload || !isPersistableImageRef(normalizedRef);
    if (pending) ids.push(imageId);
  }

  return ids;
}

export function getPendingUploadSummary(): PendingUploadSummary {
  const inFlightUploads = getInFlightUploadCount();
  const content = useProjectContentStore.getState().content;
  const pendingImageIds = new Set<string>();
  getNonRemoteImageAssetIds(content).forEach((id) => pendingImageIds.add(id));
  getPendingRuntimeImageIds().forEach((id) => pendingImageIds.add(id));
  const pendingImageAssets = pendingImageIds.size;
  const pendingFlowNodes = getNonPersistableFlowImageNodeIds(content).length;
  const hasPending =
    inFlightUploads > 0 || pendingImageAssets > 0 || pendingFlowNodes > 0;

  return {
    inFlightUploads,
    pendingImageAssets,
    pendingFlowNodes,
    hasPending,
  };
}
