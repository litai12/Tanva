// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { memoryMonitor } from '@/utils/memoryMonitor';
import type { MemoryStats } from '@/utils/memoryMonitor';
import { Activity, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';

interface MemoryDebugPanelProps {
  isVisible?: boolean;
  onClose?: () => void;
}

const MemoryDebugPanel: React.FC<MemoryDebugPanelProps> = ({
  isVisible = false,
  onClose,
}) => {
  const [stats, setStats] = useState<MemoryStats>(memoryMonitor.getStats());

  // 定期更新统计信息
  useEffect(() => {
    if (isVisible) {
      const interval = setInterval(() => {
        setStats(memoryMonitor.getStats());
      }, 1000);

      return () => {
        clearInterval(interval);
      };
    }
  }, [isVisible]); // 只依赖 isVisible，避免无限循环

  const handleForceCleanup = () => {
    memoryMonitor.forceCleanup();
    setStats(memoryMonitor.getStats());
  };

  const getTotalPoolSize = () => {
    return (
      stats.activePoolSize.mainDots +
      stats.activePoolSize.minorDots +
      stats.activePoolSize.gridLines
    );
  };

  const getMemoryStatus = () => {
    if (stats.memoryWarning) {
      return { icon: AlertTriangle, color: 'text-red-500', text: '警告' };
    }
    return { icon: CheckCircle, color: 'text-green-500', text: '正常' };
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}分${seconds % 60}秒`;
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || Number.isNaN(bytes)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let current = bytes;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
      current /= 1024;
      unitIndex += 1;
    }
    return `${current.toFixed(unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
  };

  const heapLimit = stats.browserMemory.jsHeapSizeLimit || 0;
  const heapUsage = stats.browserMemory.usedJSHeapSize || 0;
  const heapPercent =
    heapLimit > 0 ? Math.min(100, Math.round((heapUsage / heapLimit) * 100)) : 0;

  const getPoolPercent = (value: number, max: number) => {
    if (!max) return 0;
    const percent = Math.round((value / max) * 100);
    return Math.min(100, Math.max(0, percent));
  };

  const formatSinceLastCleanup = () => {
    const elapsed = Date.now() - stats.lastCleanup;
    return `${formatTime(elapsed)}前`;
  };

  // 参考上限 + 动态自适应，避免点阵模式下动辄超限
  const poolDefaults = {
    mainDots: 200,
    minorDots: 500,
    gridLines: 1000,
  };

  const deriveCap = (value: number, base: number) => {
    const padded = Math.max(base, Math.ceil(value * 1.2)); // 预留 20% 富余
    if (padded === 0) return base;
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(padded)) - 1));
    return Math.ceil(padded / magnitude) * magnitude;
  };

  const poolLimits = {
    mainDots: deriveCap(stats.activePoolSize.mainDots, poolDefaults.mainDots),
    minorDots: deriveCap(stats.activePoolSize.minorDots, poolDefaults.minorDots),
    gridLines: deriveCap(stats.activePoolSize.gridLines, poolDefaults.gridLines),
  };

  const totalLimit = poolLimits.mainDots + poolLimits.minorDots + poolLimits.gridLines;

  const barTone = (percent: number) => {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 70) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  if (!isVisible || typeof document === 'undefined') return null;

  const status = getMemoryStatus();
  const StatusIcon = status.icon;
  const totalPoolSize = getTotalPoolSize();

  const panel = (
    <div className="fixed top-20 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] pointer-events-auto">
      <Card className="shadow-xl border-slate-200/80 bg-white/95 backdrop-blur">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600">
                <Activity className="w-4 h-4" />
              </div>
              内存监控
            </CardTitle>
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

        <CardContent className="space-y-4">
          {/* Memory Status */}
          <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <div className="flex flex-col text-xs text-muted-foreground">
              <span className="font-medium text-slate-700">状态</span>
              <span className="mt-0.5 text-[11px]">
                {stats.memoryWarning ? '检测到内存压力' : '运行稳定'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon className={`w-4 h-4 ${status.color}`} />
              <Badge
                variant={stats.memoryWarning ? 'destructive' : 'secondary'}
                className="text-[11px] px-2 py-0.5"
              >
                {status.text}
              </Badge>
            </div>
          </div>

          {/* Paper.js Statistics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2.5 space-y-2">
              <h4 className="text-[11px] font-semibold text-slate-600">
                Paper.js 对象
              </h4>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">图层数</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {stats.totalLayers}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">总对象</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {stats.totalItems}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">网格对象</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {stats.gridItems}
                  </span>
                </div>
              </div>
            </div>

            {/* Browser Memory */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2.5 space-y-2">
              <h4 className="text-[11px] font-semibold text-slate-600">
                浏览器内存
              </h4>
              {stats.browserMemory.supported ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">JS Heap</span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {formatBytes(heapUsage)} / {formatBytes(heapLimit)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full ${barTone(heapPercent)}`}
                        style={{ width: `${heapPercent}%` }}
                      />
                    </div>
                    <span className="font-mono tabular-nums text-[11px] text-slate-700">
                      {heapPercent}%
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] leading-5 text-muted-foreground">
                  当前环境不支持 heap 统计（需桌面浏览器或开启 performance.memory）
                </p>
              )}
            </div>
          </div>

          {/* Object Pool Statistics */}
          <div className="rounded-lg border border-slate-100 bg-white/60 px-3 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-semibold text-slate-600">对象池</h4>
              <span className="text-[11px] text-muted-foreground">
                总池 {totalPoolSize}/{totalLimit}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>主网格点</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {stats.activePoolSize.mainDots}/{poolLimits.mainDots}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${barTone(
                      getPoolPercent(stats.activePoolSize.mainDots, poolLimits.mainDots)
                    )}`}
                    style={{
                      width: `${getPoolPercent(
                        stats.activePoolSize.mainDots,
                        poolLimits.mainDots
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>副网格点</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {stats.activePoolSize.minorDots}/{poolLimits.minorDots}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${barTone(
                      getPoolPercent(stats.activePoolSize.minorDots, poolLimits.minorDots)
                    )}`}
                    style={{
                      width: `${getPoolPercent(
                        stats.activePoolSize.minorDots,
                        poolLimits.minorDots
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>网格线</span>
                  <span className="font-mono tabular-nums text-slate-900">
                  {stats.activePoolSize.gridLines}/{poolLimits.gridLines}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${barTone(
                      getPoolPercent(stats.activePoolSize.gridLines, poolLimits.gridLines)
                    )}`}
                    style={{
                      width: `${getPoolPercent(
                        stats.activePoolSize.gridLines,
                        poolLimits.gridLines
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="flex justify-between border-t pt-2 text-[11px] font-medium text-slate-700">
                <span>总池大小</span>
                <span className="font-mono tabular-nums">
                  {totalPoolSize}/{totalLimit}
                </span>
              </div>
            </div>
          </div>

          {/* Memory Management */}
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-3 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>上次清理</span>
              <span className="font-mono tabular-nums text-slate-900">
                {formatSinceLastCleanup()}
              </span>
            </div>

            <Button
              onClick={handleForceCleanup}
              size="sm"
              variant="default"
              className="w-full h-9 text-xs font-medium shadow-sm"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              强制清理
            </Button>
          </div>

          {/* Debug Info */}
          {import.meta.env.DEV && (
            <div className="text-xs text-muted-foreground bg-slate-50 p-2 rounded border border-slate-100">
              <pre className="whitespace-pre-wrap font-mono text-[10px]">
                {memoryMonitor.getMemorySummary()}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return createPortal(panel, document.body);
};

export default MemoryDebugPanel;
