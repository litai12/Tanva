import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/stores/projectStore';
import { Button } from '@/components/ui/button';
import SmartImage from '@/components/ui/SmartImage';
import { Check, Pencil, Share2, Trash2, Users } from 'lucide-react';
import { usePendingUploadLeaveGuard } from '@/hooks/usePendingUploadLeaveGuard';
import { useTranslation } from 'react-i18next';
import { projectApi, type Project } from '@/services/projectApi';
import type { ProjectContentSnapshot } from '@/types/project';
import { useTeamStore } from '@/stores/teamStore';

function formatDate(iso: string, locale?: string) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(locale);
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

const PAGE_SIZE = 12;
const MAX_PREVIEW_IMAGES = 16;
const PREVIEW_FETCH_LIMIT = 32;

type ProjectPreviewCacheEntry = {
  version: number;
  images: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = normalizeString(item);
    return normalized ? [normalized] : [];
  });
}

function isLikelyImageRef(value: string): boolean {
  if (/^data:/i.test(value)) return /^data:image\//i.test(value);
  if (/^(blob:|flow-asset:)/i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^(projects|uploads|templates|videos|ai)\//i.test(value)) return true;
  if (/\.(png|jpe?g|webp|gif|avif|svg)([?#].*)?$/i.test(value)) return true;

  const compact = value.replace(/\s+/g, '');
  return compact.length > 1024 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function addPreviewImage(images: string[], seen: Set<string>, value: unknown) {
  if (images.length >= PREVIEW_FETCH_LIMIT) return;
  const normalized = normalizeString(value);
  if (!normalized || !isLikelyImageRef(normalized) || seen.has(normalized)) return;
  seen.add(normalized);
  images.push(normalized);
}

function addObjectImage(images: string[], seen: Set<string>, value: unknown) {
  if (!isRecord(value)) {
    addPreviewImage(images, seen, value);
    return;
  }

  addPreviewImage(
    images,
    seen,
    pickFirstString(
      value.previewUrl,
      value.previewKey,
      value.thumbnail,
      value.thumbnailDataUrl,
      value.thumbnailData,
      value.imageUrl,
      value.imageData,
      value.remoteUrl,
      value.key,
      value.url,
      value.src
    )
  );
}

function addObjectArrayImages(images: string[], seen: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    addObjectImage(images, seen, item);
    if (images.length >= PREVIEW_FETCH_LIMIT) return;
  }
}

function addIndexedImages(
  images: string[],
  seen: Set<string>,
  sourceValues: unknown,
  thumbnailValues?: unknown
) {
  const sources = toStringArray(sourceValues);
  const thumbnails = toStringArray(thumbnailValues);
  const count = Math.max(sources.length, thumbnails.length);

  for (let index = 0; index < count; index += 1) {
    addPreviewImage(images, seen, thumbnails[index] || sources[index]);
    if (images.length >= PREVIEW_FETCH_LIMIT) return;
  }
}

function addNodeDataImages(images: string[], seen: Set<string>, data: unknown) {
  if (!isRecord(data)) return;

  addIndexedImages(images, seen, data.imageUrls, data.thumbnails);
  addIndexedImages(images, seen, data.images, data.thumbnails);

  addObjectArrayImages(images, seen, data.images);
  addObjectArrayImages(images, seen, data.thumbnails);
  addObjectArrayImages(images, seen, data.frames);
  addObjectArrayImages(images, seen, data.splitImages);
  addObjectArrayImages(images, seen, data.referenceImages);
  addObjectArrayImages(images, seen, data.inputImages);
  addObjectArrayImages(images, seen, data.outputs);
  addObjectArrayImages(images, seen, data.results);
  addObjectArrayImages(images, seen, data.items);

  addPreviewImage(
    images,
    seen,
    pickFirstString(
      data.thumbnail,
      data.thumbnailDataUrl,
      data.thumbnailData,
      data.previewUrl,
      data.imageUrl,
      data.imageData,
      data.inputImage,
      data.sourceImage
    )
  );
}

function extractProjectPreviewImages(content: ProjectContentSnapshot): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  const assets = content.assets;

  if (isRecord(assets)) {
    if (Array.isArray(assets.images)) {
      for (const asset of assets.images) {
        addPreviewImage(
          images,
          seen,
          isRecord(asset)
            ? pickFirstString(asset.previewUrl, asset.previewKey, asset.remoteUrl, asset.key, asset.url, asset.src)
            : asset
        );
        if (images.length >= PREVIEW_FETCH_LIMIT) return images;
      }
    }

    if (Array.isArray(assets.videos)) {
      for (const asset of assets.videos) {
        const videoAsset = asset as unknown as Record<string, unknown>;
        addPreviewImage(
          images,
          seen,
          pickFirstString(videoAsset.thumbnail, videoAsset.previewUrl, videoAsset.poster)
        );
        if (images.length >= PREVIEW_FETCH_LIMIT) return images;
      }
    }
  }

  const nodes = content.flow?.nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      addNodeDataImages(images, seen, node?.data);
      if (images.length >= PREVIEW_FETCH_LIMIT) return images;
    }
  }

  return images;
}

function getPreviewGridSize(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

function ProjectPreviewGrid({
  images,
  noPreviewLabel,
}: {
  images?: string[];
  noPreviewLabel: string;
}) {
  const sourceImages = Array.isArray(images) && images.length > 0
    ? images.slice(0, MAX_PREVIEW_IMAGES)
    : [];
  const gridSize = getPreviewGridSize(sourceImages.length);
  const cellCount = sourceImages.length > 0 ? gridSize * gridSize : 0;
  const overflowCount = Array.isArray(images) && images.length > MAX_PREVIEW_IMAGES
    ? images.length - MAX_PREVIEW_IMAGES
    : 0;

  if (sourceImages.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-xs text-slate-400">
        {noPreviewLabel}
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 grid bg-white"
      style={{
        gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`,
        gap: '1px',
      }}
    >
      {Array.from({ length: cellCount }).map((_, index) => {
        const image = sourceImages[index];
        if (!image) {
          return <div key={`empty-${index}`} className="bg-slate-100" />;
        }

        return (
          <div key={`${image}-${index}`} className="relative min-h-0 min-w-0 overflow-hidden bg-slate-100">
            <SmartImage
              src={image}
              alt=""
              className="h-full w-full object-cover"
            />
            {overflowCount > 0 && index === sourceImages.length - 1 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-semibold text-white">
                +{overflowCount}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectManagerModal() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = (zhText: string, enText: string) => (isZh ? zhText : enText);
  const locale = isZh ? 'zh-CN' : 'en-US';
  const { modalOpen, closeModal, projects: personalProjects, create, open, rename, remove, loading: personalLoading, load, error: personalError } = useProjectStore();
  const teams = useTeamStore((s) => s.teams);
  const nonPersonalTeams = useMemo(() => teams.filter((t) => !t.isPersonal), [teams]);
  const guardLeave = usePendingUploadLeaveGuard();

  // 'personal' | teamId
  const [contextId, setContextId] = useState<string>('personal');
  const [teamProjects, setTeamProjects] = useState<Project[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [cloningToTeam, setCloningToTeam] = useState<string | null>(null);
  const [shareMenuProjectId, setShareMenuProjectId] = useState<string | null>(null);

  const isPersonal = contextId === 'personal';
  const projects = isPersonal ? personalProjects : teamProjects;
  const loading = isPersonal ? personalLoading : teamLoading;
  const error = isPersonal ? personalError : teamError;
  const loadTeamProjects = useCallback(async (teamId: string) => {
    setTeamLoading(true);
    setTeamError('');
    try {
      const list = await projectApi.listByTeam(teamId);
      setTeamProjects(list);
    } catch (e: any) {
      setTeamError(e?.message || '加载失败');
    } finally {
      setTeamLoading(false);
    }
  }, []);

  const [creating, setCreating] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [newName, setNewName] = useState('');
  const [page, setPage] = useState(0);
  const [previewCache, setPreviewCache] = useState<Record<string, ProjectPreviewCacheEntry>>({});
  const previewRequestsRef = useRef<Set<string>>(new Set());

  // 切换到个人时始终刷新，确保 backend 过滤后的数据是最新的
  useEffect(() => {
    if (modalOpen && isPersonal) {
      void load();
    }
    // load 引用稳定，不需加入 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, isPersonal]);

  // 切换到团队时加载对应团队的项目，切换离开时清空
  useEffect(() => {
    if (!modalOpen) return;
    if (!isPersonal) {
      setTeamProjects([]);
      void loadTeamProjects(contextId);
    }
  }, [modalOpen, contextId, isPersonal, loadTeamProjects]);

  useEffect(() => {
    if (!modalOpen) {
      setContextId('personal');
      setShareMenuProjectId(null);
      return;
    }
    setPage(0);
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    setPage((prev) => {
      const lastIndex = Math.max(0, Math.ceil(projects.length / PAGE_SIZE) - 1);
      return prev > lastIndex ? lastIndex : prev;
    });
  }, [projects.length, modalOpen]);

  useEffect(() => {
    if (!modalOpen) {
      setSelectionMode(false);
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(projects.map((p) => p.id));
      const filtered = Array.from(prev).filter((id) => valid.has(id));
      return filtered.length === prev.size ? prev : new Set(filtered);
    });

    if (projects.length === 0) {
      setSelectionMode(false);
    }
  }, [modalOpen, projects]);

  const totalPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  const paginatedProjects = useMemo(() => {
    if (projects.length === 0) return [];
    const start = page * PAGE_SIZE;
    return projects.slice(start, start + PAGE_SIZE);
  }, [projects, page]);

  useEffect(() => {
    if (!modalOpen || paginatedProjects.length === 0) return;

    for (const project of paginatedProjects) {
      const cached = previewCache[project.id];
      const hasFreshCache = cached?.version === project.contentVersion;
      if (hasFreshCache || previewRequestsRef.current.has(project.id)) continue;

      previewRequestsRef.current.add(project.id);
      void projectApi
        .getContent(project.id)
        .then(({ content }) => {
          const images = extractProjectPreviewImages(content);
          setPreviewCache((prev) => ({
            ...prev,
            [project.id]: {
              version: project.contentVersion,
              images,
            },
          }));
        })
        .catch((err) => {
          console.warn('加载项目预览图片失败:', err);
          setPreviewCache((prev) => ({
            ...prev,
            [project.id]: {
              version: project.contentVersion,
              images: [],
            },
          }));
        })
        .finally(() => {
          previewRequestsRef.current.delete(project.id);
        });
    }
  }, [modalOpen, paginatedProjects, previewCache]);

  const selectedCount = selectionMode ? selectedIds.size : 0;
  const isSelectAll = selectionMode && projects.length > 0 && projects.every((p) => selectedIds.has(p.id));

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  };

  const toggleSelect = (projectId: string) => {
    if (!selectionMode) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!selectionMode) return;
    if (isSelectAll) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(projects.map((p) => p.id)));
    }
  };

  const handleShareToTeam = async (projectId: string, teamId: string) => {
    setCloningToTeam(projectId);
    setShareMenuProjectId(null);
    try {
      await projectApi.cloneToTeam(projectId, teamId);
      alert(lt('已克隆至团队项目', 'Cloned to team projects'));
    } catch (e: any) {
      alert(lt('分享失败：', 'Share failed: ') + e?.message);
    } finally {
      setCloningToTeam(null);
    }
  };

  const handleBatchDelete = async () => {
    if (!selectionMode || selectedIds.size === 0) return;
    const targets = projects.filter((p) => selectedIds.has(p.id));
    const confirmMsg = lt(
      `确定删除以下 ${targets.length} 个项目？\n\n${targets
        .map((p) => p.name || '未命名')
        .join('\n')}`,
      `Delete the following ${targets.length} projects?\n\n${targets
        .map((p) => p.name || 'Untitled')
        .join('\n')}`
    );
    if (!confirm(confirmMsg)) return;

    setIsDeleting(true);
    const failed: string[] = [];
    for (const projectId of selectedIds) {
      try {
        await remove(projectId);
      } catch (err) {
        console.warn('删除项目失败:', err);
        failed.push(projectId);
      }
    }
    setIsDeleting(false);

    if (failed.length === 0) {
      setSelectedIds(new Set());
      setSelectionMode(false);
    } else {
      setSelectedIds(new Set(failed));
      alert(lt(`删除失败 ${failed.length} 个项目，请稍后重试。`, `Failed to delete ${failed.length} projects. Please try again later.`));
    }
  };

  if (!modalOpen) return null;
  const warnBeforeSwitchTitle = lt('切换项目前确认', 'Confirm before switching project');
  const warnBeforeCreateMessage = lt(
    '仍有图片未上传完成，新建项目会切换当前文件，可能导致图片丢失或无法保存到云端。',
    'There are still pending image uploads. Creating a new project will switch the current file and may cause image loss or failed cloud save.'
  );
  const warnBeforeOpenMessage = lt(
    '仍有图片未上传完成，切换项目可能导致图片丢失或无法保存到云端。',
    'There are still pending image uploads. Switching projects may cause image loss or failed cloud save.'
  );

  const fillerCount = Math.max(0, PAGE_SIZE - paginatedProjects.length);

  const node = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-transparent" onClick={closeModal} />
      <div className="relative flex h-[720px] max-h-[calc(100vh-48px)] w-[1180px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-xl border bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-3">
            <span className="font-medium">{lt('项目管理', 'Project Manager')}</span>
            {/* Context switcher - flat tabs */}
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => { setContextId('personal'); setPage(0); setSelectionMode(false); setSelectedIds(new Set()); setShareMenuProjectId(null); }}
                className={`px-3 py-1 rounded-md text-sm transition-colors ${isPersonal ? 'bg-white shadow-sm text-slate-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              >
                个人
              </button>
              {nonPersonalTeams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => { setContextId(team.id); setPage(0); setSelectionMode(false); setSelectedIds(new Set()); setShareMenuProjectId(null); }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md text-sm transition-colors ${contextId === team.id ? 'bg-white shadow-sm text-slate-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Users className="w-3 h-3 text-teal-500" />
                  {team.name}
                </button>
              ))}
            </div>
          </div>
          <div />
        </div>

        <div className="p-4 flex-1 flex flex-col min-h-0 gap-3">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              disabled={creating}
              onClick={() => {
                guardLeave(async () => {
                  setCreating(true);
                  try {
                    await create(lt('未命名', 'Untitled'));
                  } finally {
                    setCreating(false);
                  }
                }, {
                  title: warnBeforeSwitchTitle,
                  message: warnBeforeCreateMessage,
                });
              }}
            >
              {lt('新建项目', 'New project')}
            </Button>
            <input
              placeholder={lt('新建并命名', 'Create and name')}
              className="border text-sm px-2 py-1 rounded"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  guardLeave(async () => {
                    setCreating(true);
                    try {
                      await create(newName.trim());
                      setNewName('');
                    } finally {
                      setCreating(false);
                    }
                  }, {
                    title: warnBeforeSwitchTitle,
                    message: warnBeforeCreateMessage,
                  });
                }
              }}
            />
            <div className="flex-1" />
            {projects.length > 0 && (
              selectionMode ? (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isSelectAll}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {lt('全选', 'Select all')}
                  </label>
                  {selectedCount > 0 && (
                    <>
                      <span className="text-sm text-slate-500">
                        {lt(`已选 ${selectedCount} 项`, `${selectedCount} selected`)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleBatchDelete}
                        disabled={isDeleting}
                        className="flex items-center gap-2 border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {lt('删除', 'Delete')}
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" onClick={toggleSelectionMode}>
                    {lt('完成', 'Done')}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={toggleSelectionMode}>
                  {lt('选择', 'Select')}
                </Button>
              )
            )}
          </div>

          <div className="flex-1 min-h-0">
            <div className="h-full overflow-y-auto px-1">
              {projects.length === 0 ? (
                <div className="text-center text-slate-500 py-10 whitespace-pre-line">
                  {lt('暂无项目，点击上方“新建项目”开始', 'No projects yet. Click "New project" above to start')}
                </div>
              ) : (
                <div className="mx-auto grid w-full max-w-[1060px] grid-cols-2 gap-4 pb-4 md:grid-cols-3 lg:grid-cols-4">
                  {paginatedProjects.map((p) => {
                    const isSelected = selectedIds.has(p.id);
                    const previewEntry = previewCache[p.id];
                    const previewImages =
                      previewEntry?.version === p.contentVersion ? previewEntry.images : undefined;
                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (selectionMode) {
                            toggleSelect(p.id);
                          } else {
                            guardLeave(() => open(p.id), {
                              title: warnBeforeSwitchTitle,
                              message: warnBeforeOpenMessage,
                            });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (selectionMode) {
                              toggleSelect(p.id);
                            } else {
                              guardLeave(() => open(p.id), {
                                title: warnBeforeSwitchTitle,
                                message: warnBeforeOpenMessage,
                              });
                            }
                          }
                        }}
                        className={`group relative aspect-[16/10] overflow-hidden rounded-lg border bg-slate-100 shadow-sm transition cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white hover:border-sky-400 focus-within:border-sky-400 ${
                          selectionMode && isSelected ? 'border-sky-500 ring-2 ring-sky-200' : ''
                        }`}
                      >
                        <ProjectPreviewGrid
                          images={previewImages}
                          noPreviewLabel={previewImages === undefined ? lt('加载中', 'Loading') : lt('暂无预览', 'No Preview')}
                        />

                        {selectionMode && (
                          <button
                            type="button"
                            className={`absolute top-2 left-2 z-20 flex h-6 w-6 items-center justify-center rounded border ${
                              isSelected
                                ? 'border-sky-500 bg-sky-500 text-white shadow-sm'
                                : 'border-slate-300 bg-white/95 text-transparent shadow-sm hover:border-sky-400'
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSelect(p.id);
                            }}
                            aria-pressed={isSelected}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}

                        <div
                          className={`absolute right-2 top-2 z-20 flex gap-1 transition-opacity ${
                            selectionMode
                              ? 'opacity-0 pointer-events-none'
                              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto'
                          }`}
                        >
                          <Button
                            size="sm"
                            className="h-7 w-7 bg-white/95 px-0 text-slate-700 shadow-sm hover:bg-white"
                            variant="ghost"
                            title={lt('重命名', 'Rename')}
                            aria-label={lt('重命名', 'Rename')}
                            onClick={async (event) => {
                              event.stopPropagation();
                              const name = prompt(lt('重命名为：', 'Rename to:'), p.name);
                              if (name && name !== p.name) {
                                try {
                                  await rename(p.id, name);
                                } catch (e) {
                                  alert(lt('重命名失败：', 'Rename failed: ') + (e as Error).message);
                                }
                              }
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isPersonal && nonPersonalTeams.length > 0 && (
                            <div className="relative">
                              <Button
                                size="sm"
                                className="h-7 w-7 bg-white/95 px-0 text-teal-600 shadow-sm hover:bg-teal-50"
                                variant="ghost"
                                title={lt('分享至团队', 'Share to team')}
                                disabled={cloningToTeam === p.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setShareMenuProjectId((prev) => (prev === p.id ? null : p.id));
                                }}
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </Button>
                              {shareMenuProjectId === p.id && (
                                <div
                                  className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[140px]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <p className="px-3 py-1 text-[10px] text-slate-400 uppercase tracking-wide">分享至</p>
                                  {nonPersonalTeams.map((t) => (
                                    <button
                                      key={t.id}
                                      type="button"
                                      onClick={() => void handleShareToTeam(p.id, t.id)}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 text-slate-700"
                                    >
                                      <Users className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                                      <span className="truncate">{t.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <Button
                            size="sm"
                            className="h-7 w-7 bg-white/95 px-0 text-red-600 shadow-sm hover:bg-red-50"
                            variant="ghost"
                            disabled={isDeleting}
                            title={lt('删除', 'Delete')}
                            aria-label={lt('删除', 'Delete')}
                            onClick={async (event) => {
                              event.stopPropagation();
                              if (confirm(lt('确定删除该项目？', 'Delete this project?'))) {
                                try {
                                  await remove(p.id);
                                } catch (e) {
                                  alert(lt('删除失败：', 'Delete failed: ') + (e as Error).message);
                                }
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-3 pb-2.5 pt-8 text-white">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold leading-5 drop-shadow" title={p.name}>
                              {p.name || lt('未命名', 'Untitled')}
                            </div>
                            <div className="truncate text-[11px] leading-4 text-white/80 drop-shadow">
                              {lt('更新于', 'Updated')} {formatDate(p.updatedAt, locale)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {Array.from({ length: fillerCount }).map((_, index) => (
                    <div
                      key={`filler-${index}`}
                      aria-hidden="true"
                      className="aspect-[16/10] rounded-lg border bg-white opacity-0 pointer-events-none select-none"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                {lt(
                  `第 ${Math.min(page + 1, totalPages)} / ${totalPages} 页`,
                  `Page ${Math.min(page + 1, totalPages)} / ${totalPages}`
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
                >
                  {lt('上一页', 'Previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((prev) => Math.min(prev + 1, totalPages - 1))}
                >
                  {lt('下一页', 'Next')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
