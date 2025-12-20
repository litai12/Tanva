import React, { useRef, useState, useEffect } from 'react';
import ZoomIndicator from '@/components/canvas/ZoomIndicator';
import GridRenderer from '@/components/canvas/GridRenderer';
import InteractionController from '@/components/canvas/InteractionController';
import PaperCanvasManager from '@/components/canvas/PaperCanvasManager';
import ImageSizeIndicator from '@/components/canvas/ImageSizeIndicator';
import ToolBar from '@/components/toolbar/ToolBar';
import FocusModeButton from '@/components/canvas/FocusModeButton';
import DrawingController from '@/components/canvas/DrawingController';
import LayerPanel from '@/components/panels/LayerPanel';
import LibraryPanel from '@/components/panels/LibraryPanel';
import AIChatDialog from '@/components/chat/AIChatDialog';
import FloatingHeader from '@/components/layout/FloatingHeader';
import CodeSandboxPanel from '@/components/sandbox/CodeSandboxPanel';
import { useLayerStore } from '@/stores';
// import CachedImageDebug from '@/components/debug/CachedImageDebug';
import FlowOverlay from '@/components/flow/FlowOverlay';
import { migrateImageHistoryToRemote } from '@/services/imageHistoryService';
import paper from 'paper';
import { logger } from '@/utils/logger';
import GlobalZoomCapture from '@/components/canvas/GlobalZoomCapture';
// import OriginCross from '@/components/debug/OriginCross';
// import { useAIImageDisplay } from '@/hooks/useAIImageDisplay';  // 不再需要，改用快速上传逻辑

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isPaperInitialized, setIsPaperInitialized] = useState(false);
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
            try { useLayerStore.getState().ensureActiveLayer(); } catch { }
        }
    }, [isPaperInitialized]);

    return (
        <div className="relative w-full h-full overflow-hidden">
            <GlobalZoomCapture />
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

            {/* 浮动导航栏 - 专注模式时由组件自行隐藏 */}
            <FloatingHeader />

            {/* 工具列 */}
            <ToolBar />

            {/* 专注模式按钮 - 在缩放栏和工具栏之间 */}
            <FocusModeButton />

            {/* 缩放指示器 */}
            <ZoomIndicator />

            {/* 图像尺寸模式指示器 - 已隐藏 */}
            {/* <ImageSizeIndicator /> */}

            {/* 图层面板 - 始终显示，用户可以控制其可见性 */}
            <LayerPanel />

            {/* 个人库面板 - 从右侧展开 */}
            <LibraryPanel />

            {/* AI对话框 - 专注模式时由组件自行隐藏 */}
            <AIChatDialog />

            {/* Paper.js 沙盒代码面板 */}
            <CodeSandboxPanel />

            {/* 调试面板：显示缓存图像信息 */}
            {/* <CachedImageDebug /> */}
        </div>
    );
};

export default Canvas;
