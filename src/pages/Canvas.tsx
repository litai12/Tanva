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
import BackgroundRemovalTool from '@/components/canvas/BackgroundRemovalTool';
import PaperBackgroundRemovalService from '@/services/paperBackgroundRemovalService';
import { useLayerStore } from '@/stores';
import { useUIStore } from '@/stores/uiStore';
// import CachedImageDebug from '@/components/debug/CachedImageDebug';
import FlowOverlay from '@/components/flow/FlowOverlay';
import { migrateImageHistoryToRemote } from '@/services/imageHistoryService';
import paper from 'paper';
import { logger } from '@/utils/logger';
// import OriginCross from '@/components/debug/OriginCross';
// import { useAIImageDisplay } from '@/hooks/useAIImageDisplay';  // 不再需要，改用快速上传逻辑

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isPaperInitialized, setIsPaperInitialized] = useState(false);
    const ensureActiveLayer = useLayerStore(state => state.ensureActiveLayer);
    const { showBackgroundRemovalTool, setShowBackgroundRemovalTool } = useUIStore();
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

    // 处理背景移除完成
    const handleBackgroundRemovalComplete = (imageDataUrl: string) => {
        try {
            setShowBackgroundRemovalTool(false);
            logger.info('✅ Background removal completed, adding to canvas...');

            // 添加到Paper.js画布
            const raster = PaperBackgroundRemovalService.addTransparentImageToCanvas(
                imageDataUrl,
                {
                    x: paper.view.center.x,
                    y: paper.view.center.y,
                    name: `background-removed-${Date.now()}`,
                }
            );

            logger.info(`✅ Image added to canvas: ${raster.name}`);

            // 显示成功提示
            window.dispatchEvent(
                new CustomEvent('toast', {
                    detail: {
                        message: '✅ 抠图完成！已添加到画布',
                        type: 'success',
                    },
                })
            );
        } catch (error) {
            logger.error('Failed to add image to canvas:', error);
            window.dispatchEvent(
                new CustomEvent('toast', {
                    detail: {
                        message: '❌ 添加到画布失败',
                        type: 'error',
                    },
                })
            );
        }
    };

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

            {/* 浮动导航栏 - 专注模式时由组件自行隐藏 */}
            <FloatingHeader />

            {/* 工具列 */}
            <ToolBar />

            {/* 缩放指示器 */}
            <ZoomIndicator />

            {/* 图像尺寸模式指示器 - 已隐藏 */}
            {/* <ImageSizeIndicator /> */}

            {/* 图层面板 - 始终显示，用户可以控制其可见性 */}
            <LayerPanel />

            {/* AI对话框 - 专注模式时由组件自行隐藏 */}
            <AIChatDialog />

            {/* 背景移除工具 - 在屏幕中心独立显示 */}
            {showBackgroundRemovalTool && (
                <BackgroundRemovalTool
                    onRemoveComplete={handleBackgroundRemovalComplete}
                    onCancel={() => setShowBackgroundRemovalTool(false)}
                />
            )}

            {/* 调试面板：显示缓存图像信息 */}
            {/* <CachedImageDebug /> */}
        </div>
    );
};

export default Canvas;
