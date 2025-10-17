import React, { useRef, useState, useEffect } from 'react';
import ZoomIndicator from '@/components/canvas/ZoomIndicator';
import GridRenderer from '@/components/canvas/GridRenderer';
import InteractionController from '@/components/canvas/InteractionController';
import PaperCanvasManager from '@/components/canvas/PaperCanvasManager';
import ImageSizeIndicator from '@/components/canvas/ImageSizeIndicator';
import ToolBar from '@/components/toolbar/ToolBar';
import DrawingController from '@/components/canvas/DrawingController';
import LayerPanel from '@/components/panels/LayerPanel';
import AIChatDialog from '@/components/chat/AIChatDialog';
import FloatingHeader from '@/components/layout/FloatingHeader';
import { useLayerStore } from '@/stores';
import { useUIStore } from '@/stores';
import CachedImageDebug from '@/components/debug/CachedImageDebug';
import FlowOverlay from '@/components/flow/FlowOverlay';
import { migrateImageHistoryToRemote } from '@/services/imageHistoryService';
// import OriginCross from '@/components/debug/OriginCross';
// import { useAIImageDisplay } from '@/hooks/useAIImageDisplay';  // 不再需要，改用快速上传逻辑

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isPaperInitialized, setIsPaperInitialized] = useState(false);
    const ensureActiveLayer = useLayerStore(state => state.ensureActiveLayer);
    const focusMode = useUIStore(state => state.focusMode);
    // AI图像现在通过快速上传工具处理，不需要单独的hook
    // useAIImageDisplay();

    const handlePaperInitialized = () => {
        setIsPaperInitialized(true);
    };

    useEffect(() => {
        migrateImageHistoryToRemote().catch((error) => {
            try { console.warn('[Canvas] 图片历史迁移失败', error); } catch {}
        });
    }, []);

    // 确保在 Paper.js 初始化后创建默认图层
    useEffect(() => {
        if (isPaperInitialized) {
            try { ensureActiveLayer(); } catch { }
        }
    }, [isPaperInitialized, ensureActiveLayer]);

    return (
        <div className="relative w-full h-full overflow-hidden">
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                style={{ background: 'white' }}
            />

            {/* Paper.js 管理器 */}
            <PaperCanvasManager
                canvasRef={canvasRef}
                onInitialized={handlePaperInitialized}
            />

            {/* 只有在 Paper.js 初始化完成后才启用网格和交互 */}
            {isPaperInitialized && (
                <>
                    {/* 网格渲染器 */}
                    <GridRenderer canvasRef={canvasRef} isPaperInitialized={isPaperInitialized} />

                    {/* 比例尺渲染器：已移除 */}

                    {/* 交互控制器 */}
                    <InteractionController canvasRef={canvasRef} />

                    {/* 绘图控制器 */}
                    <DrawingController canvasRef={canvasRef} />
                </>
            )}

            {/* Flow 编排画布（覆盖在 Canvas 之上） */}
            <FlowOverlay />

            {/* 画布原点辅助十字（暂时关闭） */}
            {/* <OriginCross canvasRef={canvasRef} /> */}

            {/* 浮动导航栏 - 专注模式下隐藏 */}
            {!focusMode && <FloatingHeader />}

            {/* 工具列 */}
            <ToolBar />

            {/* 缩放指示器 - 专注模式下隐藏 */}
            {!focusMode && <ZoomIndicator />}

            {/* 图像尺寸模式指示器 - 已隐藏 */}
            {/* <ImageSizeIndicator /> */}

            {/* 图层面板 - 专注模式下隐藏 */}
            {!focusMode && <LayerPanel />}

            {/* AI对话框 - 专注模式下隐藏 */}
            {!focusMode && <AIChatDialog />}

            {/* 调试面板暂时隐藏，如需排查请重新挂载组件 */}
            {/* <CachedImageDebug /> */}
        </div>
    );
};

export default Canvas;
