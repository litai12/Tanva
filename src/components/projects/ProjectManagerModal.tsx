import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/stores/projectStore';
import { Button } from '@/components/ui/button';
import { Check, Trash2 } from 'lucide-react';

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

const placeholderThumb =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="sans-serif" font-size="20">No Preview</text></svg>`
  );

const PAGE_SIZE = 6;

export default function ProjectManagerModal() {
  const { modalOpen, closeModal, projects, create, open, rename, remove, loading, load, error } = useProjectStore();
  const [creating, setCreating] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [newName, setNewName] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (modalOpen && projects.length === 0 && !loading) {
      load();
    }
  }, [modalOpen, projects.length, loading, load]);

  useEffect(() => {
    if (!modalOpen) return;
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

  const handleBatchDelete = async () => {
    if (!selectionMode || selectedIds.size === 0) return;
    const targets = projects.filter((p) => selectedIds.has(p.id));
    const confirmMsg = `确定删除以下 ${targets.length} 个项目？\n\n${targets
      .map((p) => p.name || '未命名')
      .join('\n')}`;
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
      alert(`删除失败 ${failed.length} 个项目，请稍后重试。`);
    }
  };

  if (!modalOpen) return null;

  const fillerCount = Math.max(0, PAGE_SIZE - paginatedProjects.length);

  const node = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-transparent" onClick={closeModal} />
      <div className="relative bg-white rounded-xl shadow-xl w-[1000px] h-[620px] overflow-hidden border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-medium">项目管理</div>
          <div />
        </div>

        <div className="p-4 h-[calc(620px-48px)] flex flex-col min-h-0 gap-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                try {
                  await create('未命名');
                } finally {
                  setCreating(false);
                }
              }}
            >
              新建项目
            </Button>
            <input
              placeholder="新建并命名"
              className="border text-sm px-2 py-1 rounded"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  setCreating(true);
                  try {
                    await create(newName.trim());
                    setNewName('');
                  } finally {
                    setCreating(false);
                  }
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
                    全选
                  </label>
                  {selectedCount > 0 && (
                    <>
                      <span className="text-sm text-slate-500">已选 {selectedCount} 项</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleBatchDelete}
                        disabled={isDeleting}
                        className="flex items-center gap-2 border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        删除
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" onClick={toggleSelectionMode}>
                    完成
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={toggleSelectionMode}>
                  选择
                </Button>
              )
            )}
          </div>

          <div className="flex-1 min-h-0">
            <div className="h-full overflow-y-auto px-1">
              {projects.length === 0 ? (
                <div className="text-center text-slate-500 py-10 whitespace-pre-line">
                  暂无项目，点击上方“新建项目”开始
                </div>
              ) : (
                <div className="mx-auto max-w-[880px] grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-x-6 gap-y-8 items-start pb-6">
                  {paginatedProjects.map((p) => {
                    const isSelected = selectedIds.has(p.id);
                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (selectionMode) {
                            toggleSelect(p.id);
                          } else {
                            open(p.id);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (selectionMode) {
                              toggleSelect(p.id);
                            } else {
                              open(p.id);
                            }
                          }
                        }}
                        className={`group border rounded-lg overflow-hidden bg-white shadow-sm transition cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white hover:border-sky-400 focus-within:border-sky-400 ${
                          selectionMode && isSelected ? 'border-sky-500 bg-sky-50' : ''
                        }`}
                      >
                        <div className="aspect-[2/1] bg-slate-100 overflow-hidden relative flex items-center justify-center">
                          {selectionMode && (
                            <button
                              type="button"
                              className={`absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded border ${
                                isSelected
                                  ? 'border-sky-500 bg-sky-500 text-white shadow-sm'
                                  : 'border-slate-300 bg-white text-transparent hover:border-sky-400'
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
                          <img
                            src={p.thumbnailUrl || placeholderThumb}
                            alt={p.name}
                            className="h-full w-auto max-w-full object-contain"
                          />
                        </div>
                        <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate" title={p.name}>
                              {p.name || 'Untitled'}
                            </div>
                            <div className="text-[11px] leading-4 text-slate-500">更新于 {formatDate(p.updatedAt)}</div>
                          </div>
                          <div
                            className={`flex gap-1 shrink-0 transition-opacity ${
                              selectionMode
                                ? 'opacity-0 pointer-events-none'
                                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto'
                            }`}
                          >
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              variant="ghost"
                              onClick={async (event) => {
                                event.stopPropagation();
                                const name = prompt('重命名为：', p.name);
                                if (name && name !== p.name) {
                                  try {
                                    await rename(p.id, name);
                                  } catch (e) {
                                    alert('重命名失败：' + (e as Error).message);
                                  }
                                }
                              }}
                            >
                              重命名
                            </Button>
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              variant="ghost"
                              disabled={isDeleting}
                              onClick={async (event) => {
                                event.stopPropagation();
                                if (confirm('确定删除该项目？')) {
                                  try {
                                    await remove(p.id);
                                  } catch (e) {
                                    alert('删除失败：' + (e as Error).message);
                                  }
                                }
                              }}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {Array.from({ length: fillerCount }).map((_, index) => (
                    <div
                      key={`filler-${index}`}
                      aria-hidden="true"
                      className="group border rounded-lg overflow-hidden bg-white shadow-sm opacity-0 pointer-events-none select-none"
                    >
                      <div className="aspect-[2/1] bg-slate-100" />
                      <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">&nbsp;</div>
                          <div className="text-[11px] leading-4 text-slate-500">&nbsp;</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <div className="h-6 w-10" />
                          <div className="h-6 w-10" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                第 {Math.min(page + 1, totalPages)} / {totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((prev) => Math.min(prev + 1, totalPages - 1))}
                >
                  下一页
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
