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
        <div className="fixed top-20 right-4 bg-green-500/75 text-white px-3 py-2 rounded-lg shadow-lg backdrop-blur-md z-40 flex items-center gap-2">
            <Maximize2 className="w-4 h-4" />
            <span className="text-sm font-medium">原始尺寸模式</span>
            <div className="text-xs opacity-90">1像素=1像素</div>
        </div>
    );
};

export default ImageSizeIndicator;
