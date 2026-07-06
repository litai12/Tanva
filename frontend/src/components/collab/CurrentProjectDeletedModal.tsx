import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useTeamStore } from '@/stores/teamStore';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { projectApi } from '@/services/projectApi';
import { paperSaveService } from '@/services/paperSaveService';
import { flowSaveService } from '@/services/flowSaveService';
import { sanitizeProjectContentForCloudSave } from '@/utils/projectContentValidation';
import { CURRENT_PROJECT_DELETED_EVENT } from '@/hooks/useTeamRealtime';

type DeletedInfo = { projectId: string; projectName: string };

/**
 * 「当前项目被他人删除」的友好交互：
 * - 团队成员删除了我正在编辑的项目时，useTeamRealtime 已暂停自动保存并派发事件。
 * - 这里弹阻断式模态框，主操作「另存为新项目」把当前画布内容落成一个新项目（不丢在编工作），
 *   次操作「返回项目列表」清掉幽灵项目并打开项目管理器重选。
 * 仅处理「删除的恰是当前项目」这一种情况；其它项目的删除只刷新列表，不打断当前视图。
 */
const CurrentProjectDeletedModal: React.FC = () => {
  const [info, setInfo] = useState<DeletedInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDeleted = (e: Event) => {
      const detail = (e as CustomEvent).detail as { projectId?: string } | undefined;
      const projectId = detail?.projectId;
      if (!projectId) return;
      const store = useProjectStore.getState();
      // 二次确认：仅当被删的确实是当前打开的项目时才弹窗。
      if (store.currentProjectId !== projectId) return;
      const projectName = store.currentProject?.name || '未命名项目';
      setError(null);
      setInfo({ projectId, projectName });
    };
    window.addEventListener(CURRENT_PROJECT_DELETED_EVENT, onDeleted as EventListener);
    return () => window.removeEventListener(CURRENT_PROJECT_DELETED_EVENT, onDeleted as EventListener);
  }, []);

  // 返回项目列表：清掉幽灵项目（URL/本地记录/内容态），打开项目管理器重选。
  const handleBackToList = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('projectId')) {
        url.searchParams.delete('projectId');
        window.history.replaceState(
          {},
          '',
          `${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ''}${url.hash}`,
        );
      }
    } catch {}
    try { localStorage.removeItem('current_project_id'); } catch {}
    try { useProjectContentStore.getState().setProject(null); } catch {}
    try {
      useProjectStore.setState({ currentProjectId: null, currentProject: null });
      const store = useProjectStore.getState();
      store.openModal();
      void store.refreshList();
    } catch {}
    setInfo(null);
  }, []);

  // 另存为新项目：把当前画布内容落成一个新项目（按当前身份归属团队/个人），随后切过去。
  const handleSaveAsNew = useCallback(async () => {
    if (!info || saving) return;
    setSaving(true);
    setError(null);
    try {
      // 1) flush paper + flow，确保内容 store 反映最新画布。
      try { await paperSaveService.saveImmediately(); } catch {}
      try { await flowSaveService.flushFlowNodeImageRefs(); } catch {}

      const contentState = useProjectContentStore.getState();
      const rawContent = contentState.content;
      const sanitized = rawContent
        ? (sanitizeProjectContentForCloudSave(rawContent)?.sanitized ?? rawContent)
        : null;

      // 2) 按当前身份决定归属团队（团队身份→共享给该团队，个人→个人项目）。
      const { activeTeamId, teams } = useTeamStore.getState();
      const activeTeam = teams.find((t) => t.id === activeTeamId);
      const teamId = activeTeam && !activeTeam.isPersonal ? activeTeam.id : undefined;

      const newName = `${info.projectName} (恢复)`;
      const newProject = await projectApi.create({ name: newName, teamId });

      // 3) 写入内容（新项目从 v1 起，传其 contentVersion 作为 baseVersion，不会触发冲突合并）。
      if (sanitized) {
        await projectApi.saveContent(newProject.id, {
          content: sanitized,
          version: newProject.contentVersion ?? 1,
        });
      }

      // 4) 插入列表并切换；切换后 ProjectAutosaveManager 会按新 projectId 从云端重载内容，
      //    画布据此重建，cacheValidationPending 也随加载流程复位、自动保存恢复。
      useProjectStore.setState((s) => ({ projects: [newProject, ...s.projects] }));
      useProjectStore.getState().open(newProject.id);
      setInfo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '另存为新项目失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [info, saving]);

  if (!info) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(15,23,42,0.22)] border border-slate-200 p-5 w-[360px]">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800">项目已被团队成员删除</h3>
        </div>
        <p className="text-[13px] leading-relaxed text-slate-600">
          「{info.projectName}」已被团队成员删除，无法继续保存。你当前的改动还在本地，可另存为一个新项目以免丢失。
        </p>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={handleSaveAsNew}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? '保存中…' : '另存为新项目'}
          </button>
          <button
            type="button"
            onClick={handleBackToList}
            disabled={saving}
            className="px-3 h-9 rounded-xl text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-60 transition-colors"
          >
            返回列表
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CurrentProjectDeletedModal;
