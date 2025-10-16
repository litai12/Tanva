import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/stores/projectStore';
import { Button } from '@/components/ui/button';

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

const placeholderThumb = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="sans-serif" font-size="20">No Preview</text></svg>`
);

const PAGE_SIZE = 6;

export default function ProjectManagerModal() {
  const { modalOpen, closeModal, projects, create, open, rename, remove, loading, load, error } = useProjectStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const [creating, setCreating] = useState(false);
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

  const totalPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  const paginatedProjects = useMemo(() => {
    if (projects.length === 0) return [];
    const start = page * PAGE_SIZE;
    return projects.slice(start, start + PAGE_SIZE);
  }, [projects, page]);

  if (!modalOpen) return null;

  const node = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-transparent" onClick={closeModal} />
      <div className="relative bg-white rounded-xl shadow-xl w-[1000px] h-[560px] overflow-hidden border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-medium">项目管理</div>
          <div />
        </div>

        <div className="p-4 h-[calc(560px-48px)] flex flex-col min-h-0 gap-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button disabled={creating} onClick={async () => {
              setCreating(true);
              try { await create('未命名'); } finally { setCreating(false); }
            }}>新建项目</Button>
            <input
              placeholder="新建并命名"
              className="border text-sm px-2 py-1 rounded"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  setCreating(true);
                  try { await create(newName.trim()); setNewName(''); } finally { setCreating(false); }
                }
              }}
            />
          </div>

          <div className="flex-1 min-h-0">
            <div className="h-full overflow-y-auto px-1">
              {projects.length === 0 ? (
                <div className="text-center text-slate-500 py-10 whitespace-pre-line">
                  暂无项目，点击上方“新建项目”开始
                </div>
              ) : (
                <div className="mx-auto max-w-[880px] grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-x-6 gap-y-8 items-start pb-6">
                  {paginatedProjects.map((p) => (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => open(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          open(p.id);
                        }
                      }}
                      className="group border rounded-lg overflow-hidden bg-white shadow-sm transition cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white hover:border-sky-400 focus-within:border-sky-400"
                    >
                      <div className="aspect-[2/1] bg-slate-100 overflow-hidden">
                        <img src={p.thumbnailUrl || placeholderThumb} alt={p.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate" title={p.name}>{p.name || 'Untitled'}</div>
                          <div className="text-[11px] leading-4 text-slate-500">更新于 {formatDate(p.updatedAt)}</div>
                        </div>
                        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
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
                          {p.id !== currentProjectId && (
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              variant="ghost"
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
                          )}
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
