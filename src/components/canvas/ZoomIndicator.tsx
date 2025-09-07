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
        <div className="absolute bottom-4 left-4 z-10">
            <div className="bg-glass backdrop-blur-md border border-glass rounded-lg shadow-glass-xl">
                <div className="flex items-center">
                    {/* 缩小按钮 */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 rounded-l-lg rounded-r-none border-r transition-all duration-200 ${
                            !canZoomOut 
                                ? 'opacity-40 cursor-not-allowed' 
                                : 'hover:bg-blue-50 hover:text-blue-600'
                        }`}
                        onClick={zoomOut}
                        disabled={!canZoomOut}
                        title={canZoomOut ? "缩小 10%" : "已达最小缩放 (10%)"}
                    >
                        <span className="text-lg font-bold">−</span>
                    </Button>

                    {/* 缩放百分比 - 点击重置 */}
                    <button
                        className={`px-3 py-2 text-sm font-mono font-medium transition-all duration-200 ${
                            currentPercent === 100
                                ? 'text-gray-500'
                                : 'text-blue-600 hover:bg-blue-50'
                        }`}
                        onClick={resetZoom}
                        title={currentPercent === 100 ? "当前为100%" : "点击重置为100%"}
                        disabled={currentPercent === 100}
                    >
                        {formatZoom(zoom)}
                    </button>

                    {/* 放大按钮 */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 w-8 p-0 rounded-r-lg rounded-l-none border-l transition-all duration-200 ${
                            !canZoomIn 
                                ? 'opacity-40 cursor-not-allowed' 
                                : 'hover:bg-blue-50 hover:text-blue-600'
                        }`}
                        onClick={zoomIn}
                        disabled={!canZoomIn}
                        title={canZoomIn ? "放大 10%" : "已达最大缩放 (300%)"}
                    >
                        <span className="text-lg font-bold">+</span>
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ZoomIndicator;