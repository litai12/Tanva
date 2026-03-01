import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { historyService, type HistoryDebugInfo } from '@/services/historyService';
import { History, Undo2, Redo2, ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react';

interface HistoryDebugPanelProps {
  isVisible?: boolean;
  onClose?: () => void;
}

const HistoryDebugPanel: React.FC<HistoryDebugPanelProps> = ({
  isVisible = false,
  onClose,
}) => {
  const [info, setInfo] = useState<HistoryDebugInfo | null>(null);
  const [expandPast, setExpandPast] = useState(true);
  const [expandFuture, setExpandFuture] = useState(true);

  // 拖动状态
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (isVisible) {
      const update = () => setInfo(historyService.getDebugInfo());
      update();
      const interval = setInterval(update, 500);
      return () => clearInterval(interval);
    }
  }, [isVisible]);

  if (!isVisible || typeof document === 'undefined') return null;

  const formatTime = (savedAt: string | null) => {
    if (!savedAt) return '-';
    try {
      return new Date(savedAt).toLocaleTimeString();
    } catch {
      return savedAt;
    }
  };

  const renderSnapshotItem = (
    snap: HistoryDebugInfo['pastSnapshots'][0],
    type: 'past' | 'future' | 'present'
  ) => {
    const bgColor = type === 'present'
      ? 'bg-blue-50 border-blue-200'
      : type === 'past'
        ? 'bg-amber-50/50 border-amber-100'
        : 'bg-emerald-50/50 border-emerald-100';

    const totalAssets = snap.assetCount.images + snap.assetCount.models + snap.assetCount.texts;

    return (
      <div
        key={`${type}-${snap.index}`}
        className={`rounded-md border px-2.5 py-2 ${bgColor} space-y-1`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-700">
            {type === 'present' ? '当前状态' : `#${snap.index + 1}`}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            v{snap.version}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          <div className="flex justify-between">
            <span>图层</span>
            <span className="font-mono text-slate-700">{snap.layerCount}</span>
          </div>
          <div className="flex justify-between">
            <span>资源</span>
            <span className="font-mono text-slate-700">{totalAssets}</span>
          </div>
          <div className="flex justify-between">
            <span>画布</span>
            <span className="font-mono text-slate-700">
              {snap.hasPaperJson ? `${Math.round(snap.paperJsonLen / 1024)}KB` : '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Flow</span>
            <span className="font-mono text-slate-700">{snap.hasFlow ? '有' : '-'}</span>
          </div>
        </div>
        {totalAssets > 0 && (
          <div className="flex gap-1.5 pt-1">
            {snap.assetCount.images > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                图片 {snap.assetCount.images}
              </Badge>
            )}
            {snap.assetCount.models > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                3D {snap.assetCount.models}
              </Badge>
            )}
            {snap.assetCount.texts > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                文字 {snap.assetCount.texts}
              </Badge>
            )}
          </div>
        )}
        <div className="text-[9px] text-muted-foreground pt-0.5">
          保存于: {formatTime(snap.savedAt)}
        </div>
      </div>
    );
  };

  const panel = (
    <div
      className="fixed z-50 w-[320px] max-w-[calc(100vw-2rem)] pointer-events-auto"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      <Card className="shadow-xl border-slate-200/80 bg-white/95 backdrop-blur max-h-[80vh] overflow-hidden flex flex-col">
        <CardHeader className="pb-3 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div
              className="flex items-center gap-2 cursor-grab active:cursor-grabbing select-none"
              onMouseDown={handleMouseDown}
            >
              <GripHorizontal className="w-4 h-4 text-slate-400" />
              <CardTitle className="text-base flex items-center gap-2 text-slate-900">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-violet-50 text-violet-600">
                  <History className="w-4 h-4" />
                </div>
                历史记录调试
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
            >
              ×
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 overflow-y-auto flex-1">
          {!info ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              无项目历史记录
            </div>
          ) : (
            <>
              {/* 概览 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Undo2 className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-muted-foreground">可撤销</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                      {info.pastCount}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Redo2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-muted-foreground">可重做</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                      {info.futureCount}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* 当前状态 */}
              {info.present && (
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    当前状态
                  </h4>
                  {renderSnapshotItem(
                    { ...info.present, index: -1 },
                    'present'
                  )}
                </div>
              )}

              {/* 撤销栈 (Past) */}
              <div className="space-y-1.5">
                <button
                  onClick={() => setExpandPast(!expandPast)}
                  className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-600 hover:text-slate-800"
                >
                  <span className="flex items-center gap-1">
                    <Undo2 className="w-3 h-3 text-amber-600" />
                    撤销栈 ({info.pastCount})
                  </span>
                  {expandPast ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                {expandPast && (
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {info.pastSnapshots.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground text-center py-2 bg-slate-50 rounded">
                        无历史记录
                      </div>
                    ) : (
                      [...info.pastSnapshots].reverse().map((snap) =>
                        renderSnapshotItem(snap, 'past')
                      )
                    )}
                  </div>
                )}
              </div>

              {/* 重做栈 (Future) */}
              <div className="space-y-1.5">
                <button
                  onClick={() => setExpandFuture(!expandFuture)}
                  className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-600 hover:text-slate-800"
                >
                  <span className="flex items-center gap-1">
                    <Redo2 className="w-3 h-3 text-emerald-600" />
                    重做栈 ({info.futureCount})
                  </span>
                  {expandFuture ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                {expandFuture && (
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {info.futureSnapshots.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground text-center py-2 bg-slate-50 rounded">
                        无重做记录
                      </div>
                    ) : (
                      info.futureSnapshots.map((snap) =>
                        renderSnapshotItem(snap, 'future')
                      )
                    )}
                  </div>
                )}
              </div>

              {/* 记录内容说明 */}
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 space-y-2">
                <h4 className="text-[11px] font-semibold text-slate-600">
                  历史记录包含内容
                </h4>
                <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside">
                  <li>图层结构 (layers)</li>
                  <li>画布内容 (Paper.js JSON)</li>
                  <li>图片资源位置和属性</li>
                  <li>3D 模型资源</li>
                  <li>文字资源</li>
                  <li>Flow 节点和连线</li>
                  <li>视图状态 (缩放/平移)</li>
                </ul>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2">
                <Button
                  onClick={() => historyService.undo()}
                  size="sm"
                  variant="outline"
                  disabled={info.pastCount === 0}
                  className="flex-1 h-8 text-xs"
                >
                  <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                  撤销
                </Button>
                <Button
                  onClick={() => historyService.redo()}
                  size="sm"
                  variant="outline"
                  disabled={info.futureCount === 0}
                  className="flex-1 h-8 text-xs"
                >
                  <Redo2 className="w-3.5 h-3.5 mr-1.5" />
                  重做
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return createPortal(panel, document.body);
};

export default HistoryDebugPanel;
