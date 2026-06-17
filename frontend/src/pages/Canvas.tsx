import React, { useRef, useState, useEffect, useCallback } from 'react';
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
import SelectionBoxOverlay from '@/components/canvas/SelectionBoxOverlay';
import { useLayerStore } from '@/stores';
// import CachedImageDebug from '@/components/debug/CachedImageDebug';
import FlowOverlay from '@/components/flow/FlowOverlay';
import { migrateImageHistoryToRemote } from '@/services/imageHistoryService';
import { useAIChatStore } from '@/stores/aiChatStore';
import paper from 'paper';
import { logger } from '@/utils/logger';
import GlobalZoomCapture from '@/components/canvas/GlobalZoomCapture';
import GlobalEventCapture from '@/components/canvas/GlobalEventCapture';
import CollabRoot from '@/components/collab/CollabRoot';
import { CollabProvider } from '@/collab/CollabContext';
// import OriginCross from '@/components/debug/OriginCross';
// import { useAIImageDisplay } from '@/hooks/useAIImageDisplay';  // No longer needed after fast upload flow.

const Canvas: React.FC = () => {
    const chatTheme = useAIChatStore((state) => state.chatTheme);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isPaperInitialized, setIsPaperInitialized] = useState(false);
    const [isPaperReady, setIsPaperReady] = useState(false); // Delay Paper.js init.
    // AI image display now goes through fast upload flow; no extra hook needed.
    // useAIImageDisplay();

    const handlePaperInitialized = useCallback(() => {
        setIsPaperInitialized(true);
    }, []);

    // Delay Paper.js init to improve first-load performance.
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsPaperReady(true);
        }, 100); // Delay Paper.js init by 100ms.

        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        migrateImageHistoryToRemote().catch((error) => {
            try { console.warn('[Canvas] image history migration failed', error); } catch {}
        });
    }, []);

    // Ensure default layer exists after Paper.js init.
    useEffect(() => {
        if (isPaperInitialized) {
            try { useLayerStore.getState().ensureActiveLayer(); } catch { }
        }
    }, [isPaperInitialized]);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const className = 'tanva-premium-black-theme';
        if (chatTheme === 'black') {
            document.body.classList.add(className);
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove(className);
            document.body.classList.remove('dark');
        }
        return () => {
            document.body.classList.remove(className);
        };
    }, [chatTheme]);

    return (
        <CollabProvider>
        <div className="relative w-full h-full overflow-hidden">
            <GlobalEventCapture />
            <GlobalZoomCapture />
            <canvas
                ref={canvasRef}
                className="tanva-main-canvas absolute inset-0 w-full h-full"
                style={{ background: 'white' }}
            />

            {/* Paper.js manager - delayed init */}
            {isPaperReady && (
                <PaperCanvasManager
                    canvasRef={canvasRef}
                    onInitialized={handlePaperInitialized}
                />
            )}

            {/* Enable grid and interaction only after Paper.js is ready */}
            {isPaperInitialized && isPaperReady && (
                <>
                    {/* Grid renderer */}
                    <GridRenderer canvasRef={canvasRef} isPaperInitialized={isPaperInitialized} />

                    {/* Scale bar renderer removed */}

                    {/* Interaction controller */}
                    <InteractionController canvasRef={canvasRef} />

                    {/* Drawing controller */}
                    <DrawingController canvasRef={canvasRef} />
                </>
            )}

            {/* Flow canvas overlay */}
            <FlowOverlay />

            {/* Selection box overlay (above Flow nodes) */}
            <SelectionBoxOverlay />

            {/* Origin cross helper (disabled) */}
            {/* <OriginCross canvasRef={canvasRef} /> */}

            {/* Floating header - hidden by component in focus mode */}
            <FloatingHeader />

            {/* Toolbar */}
            <ToolBar />

            {/* Focus mode button between zoom and toolbar */}
            <FocusModeButton />

            {/* Zoom indicator */}
            <ZoomIndicator />

            {/* Image size mode indicator - hidden */}
            {/* <ImageSizeIndicator /> */}

            {/* Layer panel - always mounted, visibility controlled in panel */}
            <LayerPanel />

            {/* Personal library panel - expands from right side */}
            <LibraryPanel />

            {/* AI chat dialog - hidden by component in focus mode */}
            <AIChatDialog />

            {/* Paper.js sandbox code panel */}
            <CodeSandboxPanel />

            {/* Real-time team collaboration overlay (presence, cursors, toasts) */}
            <CollabRoot />

            {/* Debug panel for cached image info (hidden) */}
            {/* <CachedImageDebug /> */}
        </div>
        </CollabProvider>
    );
};

export default Canvas;
