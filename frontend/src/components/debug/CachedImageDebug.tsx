import React, { useEffect, useMemo, useRef, useState } from 'react';
import { contextManager } from '@/services/contextManager';

interface CachedImageInfo {
  imageId: string;
  imageData: string; // base64字符串或data URL
  prompt: string;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  layerId?: string | null;
  remoteUrl?: string | null;
}

// 临时调试面板：显示当前缓存的图片信息与缩略图预览
// 注意：这是临时测试功能，后续可移除或加开关
const CachedImageDebug: React.FC = () => {
  const [cached, setCached] = useState<CachedImageInfo | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [expanded, setExpanded] = useState(true);
  const lastKeyRef = useRef<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [retryStatus, setRetryStatus] = useState<string>('');
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [lastAspectRatio, setLastAspectRatio] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState<any>(null);

  // 事件驱动：监听 cachedImageChanged
  useEffect(() => {
    const apply = (data: any) => {
      if (!data) {
        if (lastKeyRef.current !== 'none') {
          lastKeyRef.current = 'none';
          setCached(null);
        }
        return;
      }
      const key = `${data.imageId}:${data.imageData?.length || 0}:${data.remoteUrl ? data.remoteUrl.length : 0}:${data.bounds ? `${Math.round(data.bounds.x)}-${Math.round(data.bounds.y)}-${Math.round(data.bounds.width)}-${Math.round(data.bounds.height)}` : 'no-bounds'}`;
      if (lastKeyRef.current !== key) {
        lastKeyRef.current = key;
        setCached({
          imageId: data.imageId,
          imageData: data.imageData,
          prompt: data.prompt,
          bounds: data.bounds ?? null,
          layerId: data.layerId ?? null,
          remoteUrl: data.remoteUrl ?? null
        });
      }
    };

    // 初始化一次
    try {
      apply(contextManager.getCachedImage());
      const ctx = contextManager.getCurrentContext();
      if (ctx?.currentMode) setMode(ctx.currentMode);
    } catch {}

    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      apply(ce.detail);
    };
    window.addEventListener('cachedImageChanged', handler as EventListener);
    
    const modeHandler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce?.detail?.mode) setMode(ce.detail.mode);
    };
    window.addEventListener('contextModeChanged', modeHandler as EventListener);

    // 监听重试相关事件
    const retryHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const { attempt, maxAttempts, status, isRetrying: retryState } = ce.detail || {};
      setRetryCount(attempt || 0);
      setRetryStatus(status || '');
      setIsRetrying(retryState || false);
    };
    
    // 监听可能的重试事件（根据日志推测事件名）
    window.addEventListener('imageEditRetry', retryHandler as EventListener);
    window.addEventListener('aiImageRetry', retryHandler as EventListener);
    window.addEventListener('editRetryStatus', retryHandler as EventListener);

    // 监听AI请求开始，记录长宽比
    const onAIRequestStart = (e: Event) => {
      const ce = e as CustomEvent;
      const ar = ce?.detail?.aspectRatio ?? null;
      if (ar !== undefined) setLastAspectRatio(ar);
    };
    window.addEventListener('aiRequestStart', onAIRequestStart as EventListener);
    
    // 监听控制台输出以提取重试信息
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      const message = args.join(' ');
      if (message.includes('编辑尝试') || message.includes('重试') || message.includes('第') && message.includes('次')) {
        // 尝试从日志中提取重试次数
        const retryMatch = message.match(/第(\d+)次/);
        if (retryMatch) {
          const attempt = parseInt(retryMatch[1]);
          setRetryCount(attempt);
          setIsRetrying(message.includes('进行'));
          if (message.includes('成功')) {
            setRetryStatus('成功');
            setIsRetrying(false);
          } else if (message.includes('失败')) {
            setRetryStatus('失败');
          } else {
            setRetryStatus('进行中');
          }
        }
      }
      originalConsoleLog.apply(console, args);
    };
    
    return () => {
      window.removeEventListener('cachedImageChanged', handler as EventListener);
      window.removeEventListener('contextModeChanged', modeHandler as EventListener);
      window.removeEventListener('imageEditRetry', retryHandler as EventListener);
      window.removeEventListener('aiImageRetry', retryHandler as EventListener);
      window.removeEventListener('editRetryStatus', retryHandler as EventListener);
      // 恢复原始console.log
      console.log = originalConsoleLog;
      window.removeEventListener('aiRequestStart', onAIRequestStart as EventListener);
    };
  }, []);

  // 监听API配置信息
  useEffect(() => {
    const handleApiConfig = (event: CustomEvent) => {
      setApiConfig(event.detail);
    };

    window.addEventListener('apiConfigUpdate', handleApiConfig as EventListener);
    return () => {
      window.removeEventListener('apiConfigUpdate', handleApiConfig as EventListener);
    };
  }, []);

  const previewSrc = useMemo(() => {
    if (!cached) return null;
    if (cached.imageData && cached.imageData.startsWith('data:image')) {
      return cached.imageData;
    }
    if (cached.imageData && cached.imageData.startsWith('blob:')) {
      return cached.imageData;
    }
    if (cached.imageData && cached.imageData.length > 0) {
      // 尝试将纯Base64拼接成PNG格式的数据URL
      return `data:image/png;base64,${cached.imageData}`;
    }
    if (cached.remoteUrl) {
      return cached.remoteUrl;
    }
    return null;
  }, [cached]);

  const hasImage = !!previewSrc;

  const center = useMemo(() => {
    if (!cached?.bounds) return null;
    return {
      cx: cached.bounds.x + cached.bounds.width / 2,
      cy: cached.bounds.y + cached.bounds.height / 2,
    };
  }, [cached?.bounds]);

  // 计算原始图片尺寸（naturalWidth/Height）
  useEffect(() => {
    setNaturalSize(null);
    const src = previewSrc || '';
    if (!src || !src.startsWith('data:image')) return;
    try {
      const img = new Image();
      img.onload = () => {
        setNaturalSize({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
      };
      img.src = src;
    } catch {}
  }, [previewSrc]);

  const handlePreview = () => {
    if (previewSrc) {
      try {
        window.open(previewSrc, '_blank');
      } catch {}
    }
  };

  const handleClear = () => {
    try {
      contextManager.clearImageCache();
      lastKeyRef.current = 'none';
      setCached(null);
      // 同时重置重试状态
      setRetryCount(0);
      setRetryStatus('');
      setIsRetrying(false);
    } catch {}
  };

  const handleResetRetry = () => {
    setRetryCount(0);
    setRetryStatus('');
    setIsRetrying(false);
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
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });

  const handleDragStart = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-drag-handle]')) return;

    const el = panelRef.current;
    if (!el) return;

    draggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.getBoundingClientRect().left,
      top: el.getBoundingClientRect().top,
    };
    e.preventDefault();
    e.stopPropagation();

    // 只在拖拽开始时添加全局监听器
    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !el) return;
      const dx = ev.clientX - dragStartRef.current.x;
      const dy = ev.clientY - dragStartRef.current.y;
      el.style.left = `${Math.max(8, dragStartRef.current.left + dx)}px`;
      el.style.top = `${Math.max(8, dragStartRef.current.top + dy)}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  // 预设默认位置：向下、向左一些，避免遮挡右上角账号区
  // 注意：拖拽后会切换为 left/top 布局（并将 right/bottom 置为 auto）
  return (
    <div
      ref={panelRef}
      className="fixed right-3 top-3 z-[60] pointer-events-none"
      style={{ maxWidth: 260, top: 72, right: 280 }}
    >
      <div
        className="pointer-events-auto select-none rounded-md border border-gray-300 bg-white/90 shadow-lg backdrop-blur p-2"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center justify-between gap-2 cursor-move" data-drag-handle>
          <div className="text-xs font-medium text-gray-700">调试面板</div>
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
                  模式: {mode || '—'}
                </div>
                <div className="text-[10px] text-gray-600">
                  长宽比: {lastAspectRatio || '—'}
                </div>
                <div className="text-[10px] text-gray-600">
                  中心: {center ? `cx=${Math.round(center.cx)}, cy=${Math.round(center.cy)}` : '—'}
                </div>
                <div className="text-[10px] text-gray-600">
                  尺寸: {cached?.bounds ? `${Math.round(cached.bounds.width)}×${Math.round(cached.bounds.height)}` : '—'}
                  {naturalSize ? `（原图 ${naturalSize.w}×${naturalSize.h}）` : ''}
                </div>
                <div className="text-[10px] text-gray-600">
                  图层: {cached.layerId || '—'}
                </div>
                <div className="text-[10px] text-gray-600">
                  重试: {retryCount > 0 ? `${retryCount}/5` : '—'} 
                  {isRetrying && <span className="text-orange-600 ml-1">进行中</span>}
                  {retryStatus && <span className="text-gray-500 ml-1">({retryStatus})</span>}
                </div>
                
                {/* API配置信息 */}
                {apiConfig && (
                  <div className="text-[9px] text-gray-500 bg-gray-50 p-2 rounded border">
                    <div className="font-semibold mb-1">API配置:</div>
                    <div className="space-y-1">
                      <div>模型: {apiConfig.model}</div>
                      <div>长宽比: {apiConfig.aspectRatio}</div>
                      <div>仅图像: {apiConfig.imageOnly ? '是' : '否'}</div>
                      <div>输出类型: {Array.isArray(apiConfig.responseModalities) ? apiConfig.responseModalities.join('，') : 'Text, Image'}</div>
                      <div>时间: {new Date(apiConfig.timestamp).toLocaleTimeString()}</div>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[8px]">完整配置</summary>
                      <pre className="text-[7px] mt-1 whitespace-pre-wrap break-all">
                        {JSON.stringify(apiConfig.config, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
                <div className="w-full">
                  {hasImage ? (
                    <img
                      src={previewSrc || ''}
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
                    className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 hover:bg-gray-900 text-white disabled:opacity-40"
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
                  {retryCount > 0 && (
                    <button
                      className="px-1.5 py-0.5 text-[10px] rounded bg-orange-50 hover:bg-orange-100 text-orange-600"
                      onClick={handleResetRetry}
                    >重置重试</button>
                  )}
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
