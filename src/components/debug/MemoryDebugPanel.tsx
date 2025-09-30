// @ts-nocheck
import React, { useState, useEffect } from 'react';
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
  onClose 
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
    return stats.activePoolSize.mainDots + 
           stats.activePoolSize.minorDots + 
           stats.activePoolSize.gridLines;
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

  if (!isVisible) return null;

  const status = getMemoryStatus();
  const StatusIcon = status.icon;
  const totalPoolSize = getTotalPoolSize();

  return (
    <div className="fixed top-20 right-4 z-50 w-80">
      <Card className="shadow-lg">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              内存监控
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0"
            >
              ×
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-3">
          {/* Memory Status */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">状态</span>
            <div className="flex items-center gap-1">
              <StatusIcon className={`w-3 h-3 ${status.color}`} />
              <Badge 
                variant={stats.memoryWarning ? "destructive" : "secondary"}
                className="text-xs"
              >
                {status.text}
              </Badge>
            </div>
          </div>

          {/* Paper.js Statistics */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground">Paper.js 对象</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">图层数:</span>
                <span className="ml-2 font-mono">{stats.totalLayers}</span>
              </div>
              <div>
                <span className="text-muted-foreground">总对象:</span>
                <span className="ml-2 font-mono">{stats.totalItems}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">网格对象:</span>
                <span className="ml-2 font-mono">{stats.gridItems}</span>
              </div>
            </div>
          </div>

          {/* Object Pool Statistics */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground">对象池</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">主网格点:</span>
                <span className="font-mono">{stats.activePoolSize.mainDots}/200</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">副网格点:</span>
                <span className="font-mono">{stats.activePoolSize.minorDots}/500</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">网格线:</span>
                <span className="font-mono">{stats.activePoolSize.gridLines}/50</span>
              </div>
              <div className="flex justify-between font-medium pt-1 border-t">
                <span>总池大小:</span>
                <span className="font-mono">{totalPoolSize}/750</span>
              </div>
            </div>
          </div>

          {/* Memory Management */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">上次清理:</span>
              <span className="font-mono">
                {formatTime(Date.now() - stats.lastCleanup)}前
              </span>
            </div>
            
            <Button
              onClick={handleForceCleanup}
              size="sm"
              variant="outline"
              className="w-full text-xs"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              强制清理
            </Button>
          </div>

          {/* Debug Info */}
          {import.meta.env.DEV && (
            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              <pre className="whitespace-pre-wrap font-mono text-[10px]">
                {memoryMonitor.getMemorySummary()}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MemoryDebugPanel;
