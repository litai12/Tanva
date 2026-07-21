/**
 * 手动保存（保存按钮 / Ctrl+S）的唯一实现。
 *
 * 这里必须只有一份：此前 Ctrl+S 是保存按钮逻辑的一份复制，随时间分叉后漏掉了
 * 写本地缓存、stale 判定、跨 tab 广播、allowMerge 四件事，导致
 *   ①Ctrl+S 后 IndexedDB 缓存永远落后服务端一个版本 → 下次刷新必被「内容已过期」冻结；
 *   ②服务端拒收(stale)时仍 markSaved → 显示保存成功但内容其实没落盘。
 * 任何保存语义的改动都改这里，不要再在调用方复制。
 */
import { projectApi } from '@/services/projectApi';
import { paperSaveService } from '@/services/paperSaveService';
import { flowSaveService } from '@/services/flowSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useAuthStore } from '@/stores/authStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { refreshProjectThumbnail } from '@/services/projectThumbnailService';
import { sanitizeProjectContentForCloudSave } from '@/utils/projectContentValidation';
import { setProjectCache } from '@/services/projectCacheStore';
import { collabCanvasBridge } from '@/collab/collabCanvasBridge';
import { projectVersionChannel } from '@/services/projectVersionChannel';
import { writeLastGoodSnapshot } from '@/services/projectSnapshotBackup';

/** 触发来源，只用于区分埋点事件名，保存语义完全一致。 */
export type ManualSaveOrigin = 'button' | 'keyboard' | 'history-restore';

const EVENT_PREFIX: Record<ManualSaveOrigin, string> = {
  button: 'manual',
  keyboard: 'kb',
  'history-restore': 'history_restore',
};

export type ManualSaveOutcome =
  /** 已落盘 */
  | 'saved'
  /** 前置条件不满足（无项目/正在保存/已冻结/缓存校验中），未发起请求 */
  | 'skipped'
  /** 有未上传 OSS 的图片，主动阻止云端保存 */
  | 'blocked'
  /** 服务端判定本地版本落后并拒收，已冻结画布 */
  | 'stale'
  /** 请求异常 */
  | 'error';

type Translate = (zhText: string, enText: string) => string;

export async function performManualSave(options: {
  origin: ManualSaveOrigin;
  lt: Translate;
  /** 恢复历史版本时透传，供服务端标记本次快照的来源。 */
  workflowHistoryMeta?: {
    restoredFromUpdatedAt?: string;
    restoredFromVersion?: number;
  };
}): Promise<ManualSaveOutcome> {
  const { origin, lt, workflowHistoryMeta } = options;
  const eventPrefix = EVENT_PREFIX[origin];

  const storeBefore = useProjectContentStore.getState();
  if (!storeBefore.projectId || storeBefore.saving || storeBefore.manualSaving) {
    return 'skipped';
  }
  // 已冻结：本地内容基于旧版本，再保存只会被服务端拒收。唯一出口是刷新。
  if (storeBefore.staleContent) {
    return 'skipped';
  }
  if (storeBefore.cacheValidationPending) {
    storeBefore.setWarning(
      lt(
        '本地缓存正在校验远端版本，校验完成前暂不保存。',
        'Local cache is validating the remote version; saving is paused until validation completes.'
      )
    );
    return 'skipped';
  }
  const projectIdBefore = storeBefore.projectId;

  // 必须在 flush 的 await 之前置位：否则这段窗口内 manualSaving 仍是 false，
  // 连按两次 Ctrl+S 会并发发出两份 baseVersion 相同的保存，第二份必被判 stale。
  storeBefore.setManualSaving(true);

  try {
    await paperSaveService.saveImmediately();
    await flowSaveService.flushFlowNodeImageRefs();

    const store = useProjectContentStore.getState();
    const { projectId, content, version } = store;
    if (!projectId || !content) {
      store.setError(lt('当前没有可以保存的内容', 'No content available to save'));
      return 'skipped';
    }
    // flush 期间用户切走了项目：此时 store 里已是新项目的内容，继续保存会把它写进
    // 旧项目（或反之）。任何情况下跨项目写入都是错的，直接放弃本次保存。
    if (projectId !== projectIdBefore) {
      return 'skipped';
    }

    const sanitizeResult = sanitizeProjectContentForCloudSave(content);
    const invalidCanvasImageIds = sanitizeResult?.dropped.canvasImageIds ?? [];
    const invalidFlowNodeIds = sanitizeResult?.dropped.flowNodeIds ?? [];
    const contentForCloudSave = sanitizeResult?.sanitized ?? content;
    if (invalidCanvasImageIds.length > 0 || invalidFlowNodeIds.length > 0) {
      store.setWarning(
        lt(
          `存在未上传到 OSS 的图片（画布 ${invalidCanvasImageIds.length} 张，Flow ${invalidFlowNodeIds.length} 处），已阻止云端保存，请重试上传后再保存`,
          `Found images not uploaded to OSS (Canvas ${invalidCanvasImageIds.length}, Flow ${invalidFlowNodeIds.length}); cloud save is blocked. Please upload and retry.`
        )
      );
      saveMonitor.push(projectId, `${eventPrefix}_save_blocked_local_assets`, {
        canvasCount: invalidCanvasImageIds.length,
        flowCount: invalidFlowNodeIds.length,
      });
      return 'blocked';
    }
    store.setWarning(null);

    // 记录发起保存时的修改计数:保存往返期间用户继续编辑时,markSaved 不能清掉新改动的 dirty 状态。
    const counterAtSave = store.dirtyCounter;
    const result = await projectApi.saveContent(projectId, {
      content: contentForCloudSave,
      version,
      createWorkflowHistory: true,
      allowMerge: collabCanvasBridge.connected,
      workflowHistoryMeta,
    });

    // 服务端判定本地版本落后且非协作 → 拒绝写入。冻结并强制刷新，
    // 绝不 markSaved（那会把本地旧内容的版本对齐成最新，误以为已保存）。
    if (result.stale) {
      useProjectContentStore.getState().setStaleContent(true, 'save-rejected');
      saveMonitor.push(projectId, `${eventPrefix}_save_stale_blocked`, {
        baseVersion: version,
        latestVersion: result.latestVersion,
      });
      return 'stale';
    }

    const savedAt = result.updatedAt ?? new Date().toISOString();
    useProjectContentStore.getState().markSaved(result.version, savedAt, counterAtSave);
    // 保存成功：广播新版本，让同浏览器其它落后 tab 即时冻结。
    projectVersionChannel.postSaved(projectId, result.version);
    void refreshProjectThumbnail(projectId, { force: true });

    // 必须与服务端版本同步推进：缓存停在旧版本会让下次加载把「远端更新」误判成冲突并冻结画布。
    setProjectCache({
      projectId,
      userId: useAuthStore.getState().user?.id ?? null,
      content: contentForCloudSave,
      version: result.version,
      updatedAt: savedAt,
      cachedAt: new Date().toISOString(),
    }).catch(() => {});

    saveMonitor.push(projectId, `${eventPrefix}_save_success`, {
      version: result.version,
      updatedAt: result.updatedAt,
      paperJsonLen: content.meta?.paperJsonLen || content.paperJson?.length || 0,
      layerCount: content.layers.length || 0,
    });
    writeLastGoodSnapshot(projectId, {
      version: result.version,
      updatedAt: result.updatedAt,
      paperJson: content.paperJson,
    });

    return 'saved';
  } catch (error) {
    const currentProjectId = useProjectContentStore.getState().projectId;
    const rawMessage = error instanceof Error ? error.message : String(error ?? '');
    const message =
      rawMessage.includes('413') || rawMessage.toLowerCase().includes('too large')
        ? lt('保存失败：内容过大，请尝试清理或拆分项目', 'Save failed: content is too large. Try cleaning or splitting the project')
        : rawMessage || lt('保存失败', 'Save failed');
    saveMonitor.push(currentProjectId, `${eventPrefix}_save_error`, { message });
    useProjectContentStore.getState().setError(message);
    console.error('手动保存失败:', error);
    return 'error';
  } finally {
    // 保存往返期间用户切走项目时，不要把新项目的 manualSaving 标志清掉。
    const store = useProjectContentStore.getState();
    if (store.projectId === projectIdBefore) {
      store.setManualSaving(false);
    }
  }
}
