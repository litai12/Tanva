import React, { useRef, useState } from 'react';
import ZoomIndicator from '@/components/canvas/ZoomIndicator';
import GridRenderer from '@/components/canvas/GridRenderer';
import InteractionController from '@/components/canvas/InteractionController';
import PaperCanvasManager from '@/components/canvas/PaperCanvasManager';
import ScaleBarRenderer from '@/components/canvas/ScaleBarRenderer';

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isPaperInitialized, setIsPaperInitialized] = useState(false);

    const handlePaperInitialized = () => {
        setIsPaperInitialized(true);
    };

    return (
        <div className="flex-1 relative overflow-hidden">
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
                    
                    {/* 比例尺渲染器 */}
                    <ScaleBarRenderer canvasRef={canvasRef} isPaperInitialized={isPaperInitialized} />
                    
                    {/* 交互控制器 */}
                    <InteractionController canvasRef={canvasRef} />
                </>
            )}
            
            {/* 缩放指示器 */}
            <ZoomIndicator />
        </div>
    );
};

export default Canvas;