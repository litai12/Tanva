import React, { useEffect, useMemo, useRef, useState } from 'react';
import { contextManager } from '@/services/contextManager';

interface CachedImageInfo {
  imageId: string;
  imageData: string; // data URL expected
  prompt: string;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  layerId?: string | null;
}

// 临时调试面板：显示当前缓存的图片信息与缩略图预览
// 注意：这是临时测试功能，后续可移除或加开关
const CachedImageDebug: React.FC = () => {
  const [cached, setCached] = useState<CachedImageInfo | null>(null);
  const [expanded, setExpanded] = useState(true);
  const lastKeyRef = useRef<string | null>(null);

  // 轮询获取缓存（临时实现，便于快速验证）
  useEffect(() => {
    const read = () => {
      try {
        const data = contextManager.getCachedImage();
        if (!data) {
          if (lastKeyRef.current !== 'none') {
            lastKeyRef.current = 'none';
            setCached(null);
          }
          return;
        }
        // 使用 imageId + 长度作为变化键
        const key = `${data.imageId}:${data.imageData?.length || 0}:${data.bounds ? `${Math.round(data.bounds.x)}-${Math.round(data.bounds.y)}-${Math.round(data.bounds.width)}-${Math.round(data.bounds.height)}` : 'no-bounds'}`;
        if (lastKeyRef.current !== key) {
          lastKeyRef.current = key;
          setCached({ imageId: data.imageId, imageData: data.imageData, prompt: data.prompt, bounds: data.bounds ?? null, layerId: data.layerId ?? null });
        }
      } catch (e) {
        // 忽略读取错误，保持调试组件健壮
      }
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const hasImage = !!cached?.imageData && cached.imageData.startsWith('data:image');

  const center = useMemo(() => {
    if (!cached?.bounds) return null;
    return {
      cx: cached.bounds.x + cached.bounds.width / 2,
      cy: cached.bounds.y + cached.bounds.height / 2,
    };
  }, [cached?.bounds]);

  const handlePreview = () => {
    if (cached?.imageData) {
      try {
        window.open(cached.imageData, '_blank');
      } catch {}
    }
  };

  const handleClear = () => {
    try {
      contextManager.clearImageCache();
      lastKeyRef.current = 'none';
      setCached(null);
    } catch {}
  };

  const handleCopyId = async () => {
    if (!cached?.imageId) return;
    try {
      await navigator.clipboard.writeText(cached.imageId);
    } catch {}
  };

  const handleCopyPrompt = async () => {
    if (!cached?.prompt) return;
    try {
      await navigator.clipboard.writeText(cached.prompt);
    } catch {}
  };

  // 简易可拖拽（不干扰画布交互，pointer-events 控制在容器内）
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-drag-handle]')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${Math.max(8, initLeft + dx)}px`;
      el.style.top = `${Math.max(8, initTop + dy)}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };
    const onMouseUp = () => {
      dragging = false;
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed left-3 bottom-3 z-[60] pointer-events-none"
      style={{ maxWidth: 260 }}
    >
      <div className="pointer-events-auto select-none rounded-md border border-gray-300 bg-white/90 shadow-lg backdrop-blur p-2">
        <div className="flex items-center justify-between gap-2" data-drag-handle>
          <div className="text-xs font-medium text-gray-700">缓存图片调试</div>
          <div className="flex items-center gap-1">
            <button
              className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              onClick={() => setExpanded((v) => !v)}
            >{expanded ? '收起' : '展开'}</button>
          </div>
        </div>

        {expanded && (
          <div className="mt-2 space-y-2">
            {cached ? (
              <div className="space-y-2">
                <div className="text-[10px] text-gray-600 break-all">
                  ID: <span className="font-mono">{cached.imageId}</span>
                </div>
                <div className="text-[10px] text-gray-600 break-all line-clamp-2">
                  提示: {cached.prompt || '—'}
                </div>
                <div className="text-[10px] text-gray-600">
                  中心: {center ? `cx=${Math.round(center.cx)}, cy=${Math.round(center.cy)}` : '—'}
                </div>
                <div className="text-[10px] text-gray-600">
                  图层: {cached.layerId || '—'}
                </div>
                <div className="w-full">
                  {hasImage ? (
                    <img
                      src={cached.imageData}
                      alt="cached preview"
                      className="block w-full max-w-[236px] max-h-[140px] object-contain rounded"
                    />
                  ) : (
                    <div className="w-full h-[80px] flex items-center justify-center text-[10px] text-gray-400 border border-dashed rounded">
                      无可预览的图片数据
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    className="px-1.5 py-0.5 text-[10px] rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
                    onClick={handlePreview}
                    disabled={!hasImage}
                  >预览</button>
                  <button
                    className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                    onClick={handleCopyId}
                  >复制ID</button>
                  <button
                    className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                    onClick={handleCopyPrompt}
                  >复制提示</button>
                  <button
                    className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-red-50 hover:bg-red-100 text-red-600"
                    onClick={handleClear}
                  >清除缓存</button>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-gray-500">当前无缓存图片</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CachedImageDebug;
