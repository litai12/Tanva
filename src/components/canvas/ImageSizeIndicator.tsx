/**
 * 图像尺寸模式指示器
 * 显示当前图像显示模式（原始尺寸 vs 自适应）
 */

import React, { useState, useEffect } from 'react';
import { Maximize2, RotateCcw } from 'lucide-react';

const ImageSizeIndicator: React.FC = () => {
    const [useOriginalSize, setUseOriginalSize] = useState(() => {
        return localStorage.getItem('tanva-use-original-size') === 'true';
    });

    useEffect(() => {
        const handleStorageChange = () => {
            setUseOriginalSize(localStorage.getItem('tanva-use-original-size') === 'true');
        };

        // 监听localStorage变化
        window.addEventListener('storage', handleStorageChange);

        // 监听自定义事件（用于同一页面内的更新）
        const handleModeChange = () => {
            setUseOriginalSize(localStorage.getItem('tanva-use-original-size') === 'true');
        };

        window.addEventListener('tanva-size-mode-changed', handleModeChange);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('tanva-size-mode-changed', handleModeChange);
        };
    }, []);

    if (!useOriginalSize) return null;

    return (
        <div className="fixed top-20 right-4 bg-green-500/80 text-white px-3 py-2 rounded-lg shadow-xl backdrop-blur-md border border-green-400/30 z-40 flex items-center gap-2"
             style={{
               boxShadow: '0 12px 40px rgba(34, 197, 94, 0.3), 0 4px 16px rgba(34, 197, 94, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
             }}>
            <Maximize2 className="w-4 h-4" />
            <span className="text-sm font-medium">原始尺寸模式</span>
            <div className="text-xs opacity-90">1像素=1像素</div>
        </div>
    );
};

export default ImageSizeIndicator;
