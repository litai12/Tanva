import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/stores/projectStore';
import { Button } from '@/components/ui/button';

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

const placeholderThumb = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="sans-serif" font-size="20">No Preview</text></svg>`
);

export default function ProjectManagerModal() {
  const { modalOpen, closeModal, projects, create, open, rename, remove, loading, load, error } = useProjectStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (modalOpen && projects.length === 0 && !loading) {
      load();
    }
  }, [modalOpen]);

  if (!modalOpen) return null;

  const node = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      {/* 背景透明，仅用于点击关闭 */}
      <div className="absolute inset-0 bg-transparent" onClick={closeModal} />
      <div className="relative bg-white rounded-xl shadow-xl w-[1000px] h-[600px] overflow-hidden border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-medium">项目管理</div>
          {/* 右上角关闭按钮移除，点击空白区域即可关闭 */}
          <div />
        </div>

        <div className="p-4 h-[calc(600px-48px)] flex flex-col">
          {/* 错误提示 */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="mb-4 flex gap-2">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pr-1 flex-1">
            {projects.map((p) => (
              <div key={p.id} className="group border rounded-lg overflow-hidden bg-white shadow-sm hover:shadow transition">
                <div className="aspect-[3/2] bg-slate-100 overflow-hidden">
                  <img src={p.thumbnailUrl || placeholderThumb} alt={p.name} className="w-full h-full object-cover" />
                </div>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" title={p.name}>{p.name || 'Untitled'}</div>
                    <div className="text-xs text-slate-500">更新于 {formatDate(p.updatedAt)}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => open(p.id)}>打开</Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const name = prompt('重命名为：', p.name);
                      if (name && name !== p.name) {
                        try {
                          await rename(p.id, name);
                        } catch (e) {
                          alert('重命名失败：' + (e as Error).message);
                        }
                      }
                    }}>重命名</Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (confirm('确定删除该项目？')) {
                        try {
                          await remove(p.id);
                        } catch (e) {
                          alert('删除失败：' + (e as Error).message);
                        }
                      }
                    }}>删除</Button>
                  </div>
                </div>
              </div>
            ))}
            {projects.length === 0 && (
              <div className="text-center text-slate-500 py-10 whitespace-pre-line">
                暂无项目，点击上方“新建项目”开始
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
