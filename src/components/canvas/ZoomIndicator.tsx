import React from 'react';
import { useCanvasStore } from '@/stores';
import { Button } from '@/components/ui/button';

const ZoomIndicator: React.FC = () => {
    const { zoom, setZoom } = useCanvasStore();

    // 格式化缩放百分比
    const formatZoom = (zoomValue: number): string => {
        return `${Math.round(zoomValue * 100)}%`;
    };

    // 10%步进缩放控制
    const zoomIn = () => {
        const currentPercent = Math.round(zoom * 100);
        const newPercent = Math.min(1000, currentPercent + 10);
        setZoom(newPercent / 100);
    };

    const zoomOut = () => {
        const currentPercent = Math.round(zoom * 100);
        const newPercent = Math.max(10, currentPercent - 10);
        setZoom(newPercent / 100);
    };

    const resetZoom = () => {
        setZoom(1.0);
    };

    // 检查是否到达边界
    const currentPercent = Math.round(zoom * 100);
    const canZoomIn = currentPercent < 300;
    const canZoomOut = currentPercent > 10;

    return (
        <div className="fixed left-3 bottom-4 z-10">
            <div className="bg-glass backdrop-blur-md border border-glass rounded-2xl shadow-glass-xl w-10">
                <div className="flex flex-col items-center">
                    {/* 放大按钮 */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-10 p-0 rounded-t-lg rounded-b-none border-b transition-all duration-200 flex items-center justify-center ${
                            !canZoomIn
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-blue-50 hover:text-blue-600'
                        }`}
                        onClick={zoomIn}
                        disabled={!canZoomIn}
                        title={canZoomIn ? "放大 10%" : "已达最大缩放 (300%)"}
                    >
                        <span className="text-sm font-bold">+</span>
                    </Button>

                    {/* 缩放百分比 - 点击重置 */}
                    <button
                        className={`px-1 py-3 text-xs font-mono font-medium transition-all duration-200 border-t border-b w-full text-center ${
                            currentPercent === 100
                                ? 'text-gray-400'
                                : 'text-blue-600 hover:bg-blue-50'
                        }`}
                        onClick={resetZoom}
                        title={currentPercent === 100 ? "当前为100%" : "点击重置为100%"}
                        disabled={currentPercent === 100}
                    >
                        {formatZoom(zoom)}
                    </button>

                    {/* 缩小按钮 */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-10 p-0 rounded-b-lg rounded-t-none border-t transition-all duration-200 flex items-center justify-center ${
                            !canZoomOut
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-blue-50 hover:text-blue-600'
                        }`}
                        onClick={zoomOut}
                        disabled={!canZoomOut}
                        title={canZoomOut ? "缩小 10%" : "已达最小缩放 (10%)"}
                    >
                        <span className="text-sm font-bold">−</span>
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ZoomIndicator;