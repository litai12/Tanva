import React, { useState, useRef, useEffect, useCallback } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { BoundsCalculator, type Bounds } from '@/utils/BoundsCalculator';

const ZoomIndicator: React.FC = () => {
    const { zoom, setZoom, setPan } = useCanvasStore();
    const { focusMode } = useUIStore();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const toValidBounds = (value: any): Bounds | null => {
        if (!value || typeof value !== 'object') return null;
        const x = Number(value.x);
        const y = Number(value.y);
        const width = Number(value.width);
        const height = Number(value.height);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
            return null;
        }
        if (width <= 0 || height <= 0) return null;
        return { x, y, width, height };
    };

    // 获取 Flow 节点的边界（转换为 Paper.js 世界坐标）
    const getFlowNodeBounds = (): Bounds[] => {
        const out: Bounds[] = [];
        try {
            const tanvaFlow = (window as any).tanvaFlow;
            if (!tanvaFlow?.rf) return out;

            const nodes = tanvaFlow.rf.getNodes?.() || [];
            const dpr = window.devicePixelRatio || 1;

            for (const node of nodes) {
                if (!node.position) continue;

                // Flow 节点的位置需要乘以 dpr 转换为 Paper.js 世界坐标
                // 因为 Flow viewport 是 (panX * zoom) / dpr，而 Paper.js 使用带 dpr 的坐标
                const nodeWidth = (node.data?.boxW ?? node.width ?? 200) * dpr;
                const nodeHeight = (node.data?.boxH ?? node.height ?? 150) * dpr;

                const worldX = node.position.x * dpr;
                const worldY = node.position.y * dpr;

                if (nodeWidth > 0 && nodeHeight > 0) {
                    out.push({
                        x: worldX,
                        y: worldY,
                        width: nodeWidth,
                        height: nodeHeight,
                    });
                }
            }
        } catch (e) {
            console.warn('获取 Flow 节点边界失败:', e);
        }
        return out;
    };

    // 获取当前选中的 Flow 节点边界
    const getSelectedFlowNodeBounds = (): Bounds[] => {
        const out: Bounds[] = [];
        try {
            const tanvaFlow = (window as any).tanvaFlow;
            if (!tanvaFlow?.rf) return out;
            const nodes = tanvaFlow.rf.getNodes?.() || [];
            const dpr = window.devicePixelRatio || 1;
            for (const node of nodes) {
                if (!node?.selected || !node.position) continue;
                const nodeWidth = (node.data?.boxW ?? node.width ?? 200) * dpr;
                const nodeHeight = (node.data?.boxH ?? node.height ?? 150) * dpr;
                const worldX = node.position.x * dpr;
                const worldY = node.position.y * dpr;
                const normalized = toValidBounds({
                    x: worldX,
                    y: worldY,
                    width: nodeWidth,
                    height: nodeHeight,
                });
                if (normalized) out.push(normalized);
            }
        } catch (e) {
            console.warn('获取选中 Flow 节点边界失败:', e);
        }
        return out;
    };

    // 获取所有内容的边界（Paper.js + Flow 节点）
    const getAllContentBounds = (): Bounds[] => {
        const paperBounds = BoundsCalculator.getPaperDrawingBounds();
        const flowBounds = getFlowNodeBounds();
        return [...paperBounds, ...flowBounds];
    };

    // 获取当前选中内容边界（图片/3D/路径/文本 + 选中 Flow 节点）
    const getSelectedContentBounds = (): Bounds[] => {
        const out: Bounds[] = [];
        try {
            const selection = (window as any).tanvaCanvasSelection || {};
            const selectedImageIds = new Set<string>(
                Array.isArray(selection.imageIds) ? selection.imageIds : []
            );
            const selectedModelIds = new Set<string>(
                Array.isArray(selection.modelIds) ? selection.modelIds : []
            );
            const selectedTextIds = new Set<string>(
                Array.isArray(selection.textIds) ? selection.textIds : []
            );

            const allImages = Array.isArray((window as any).tanvaImageInstances)
                ? (window as any).tanvaImageInstances
                : [];
            const allModels = Array.isArray((window as any).tanvaModel3DInstances)
                ? (window as any).tanvaModel3DInstances
                : [];
            const allTexts = Array.isArray((window as any).tanvaTextItems)
                ? (window as any).tanvaTextItems
                : [];

            const selectedImages = allImages.filter((img: any) => {
                const id = String(img?.id ?? '');
                if (!id || img?.visible === false) return false;
                const selectedBySnapshot = selectedImageIds.size > 0 && selectedImageIds.has(id);
                return selectedBySnapshot || !!img?.isSelected;
            });
            const selectedModels = allModels.filter((model: any) => {
                const id = String(model?.id ?? '');
                if (!id || model?.visible === false) return false;
                const selectedBySnapshot = selectedModelIds.size > 0 && selectedModelIds.has(id);
                return selectedBySnapshot || !!model?.isSelected;
            });

            const selectedPaperItems = new Set<paper.Item>();
            const pushPaperItem = (item: any) => {
                if (!item || item?.data?.isHelper) return;
                if (typeof item?.isInserted === 'function' && !item.isInserted()) return;
                selectedPaperItems.add(item as paper.Item);
            };

            if (Array.isArray(selection.paths)) {
                selection.paths.forEach((path: any) => pushPaperItem(path));
            }

            allTexts.forEach((textItem: any) => {
                const id = String(textItem?.id ?? '');
                const selectedBySnapshot = selectedTextIds.size > 0 && selectedTextIds.has(id);
                if ((selectedBySnapshot || !!textItem?.isSelected) && textItem?.paperText) {
                    pushPaperItem(textItem.paperText);
                }
            });

            try {
                const selectedByPaper = Array.isArray(paper.project?.selectedItems)
                    ? paper.project!.selectedItems
                    : [];
                selectedByPaper.forEach((item) => pushPaperItem(item));
            } catch {}

            const selectionBounds = BoundsCalculator.calculateSelectionBounds(
                selectedImages as any,
                selectedModels as any,
                Array.from(selectedPaperItems),
                0
            );
            const normalizedSelectionBounds = toValidBounds(selectionBounds);
            if (!selectionBounds.isEmpty && normalizedSelectionBounds) {
                out.push(normalizedSelectionBounds);
            }
        } catch (e) {
            console.warn('获取选中内容边界失败:', e);
        }

        const selectedFlowBounds = getSelectedFlowNodeBounds();
        return out.concat(selectedFlowBounds);
    };

    const fitBoundsToView = (
        bounds: Bounds[],
        options?: { fallbackToCenter?: boolean }
    ): boolean => {
        const metrics = getViewMetrics();
        if (!metrics) {
            setMenuOpen(false);
            return false;
        }

        if (bounds.length === 0) {
            if (options?.fallbackToCenter) {
                setZoom(1.0);
                setPan(metrics.centerX, metrics.centerY);
            }
            setMenuOpen(false);
            return false;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of bounds) {
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        }

        const contentWidth = Math.max(1, maxX - minX);
        const contentHeight = Math.max(1, maxY - minY);
        const contentCenterX = minX + contentWidth / 2;
        const contentCenterY = minY + contentHeight / 2;

        const padding = 40 * metrics.dpr;
        const availableWidth = Math.max(1, metrics.width - padding * 2);
        const availableHeight = Math.max(1, metrics.height - padding * 2);

        const scaleX = availableWidth / contentWidth;
        const scaleY = availableHeight / contentHeight;
        let newZoom = Math.min(scaleX, scaleY);
        newZoom = Math.max(0.1, Math.min(4, newZoom));

        const newPanX = metrics.centerX / newZoom - contentCenterX;
        const newPanY = metrics.centerY / newZoom - contentCenterY;

        setZoom(newZoom);
        setPan(newPanX, newPanY);
        setMenuOpen(false);
        return true;
    };

    const getViewMetrics = () => {
        const view = paper?.view;
        if (!view || !view.viewSize) return null;
        const { width, height } = view.viewSize;
        if (!width || !height) return null;

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        return {
            width,
            height,
            centerX: width / 2,
            centerY: height / 2,
            dpr,
        };
    };

    // 点击外部关闭菜单
    useEffect(() => {
        if (focusMode) {
            setMenuOpen(false);
            return;
        }
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };
        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [menuOpen, focusMode]);

    // 专注模式下隐藏缩放控件
    if (focusMode) {
        return null;
    }

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
        const metrics = getViewMetrics();
        if (!metrics) {
            // 备用方案：简单重置
            setZoom(1.0);
            const dpr = window.devicePixelRatio || 1;
            const centerX = (window.innerWidth / 2) * dpr;
            const centerY = (window.innerHeight / 2) * dpr;
            setPan(centerX, centerY);
            setMenuOpen(false);
            return;
        }

        // 获取画布内容的边界（包含 Flow 节点）
        const bounds = getAllContentBounds();

        if (bounds.length === 0) {
            // 没有内容时，将世界坐标原点居中
            setZoom(1.0);
            setPan(metrics.centerX, metrics.centerY);
            setMenuOpen(false);
            return;
        }

        // 计算所有元素的联合边界中心点
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of bounds) {
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        }

        const contentCenterX = (minX + maxX) / 2;
        const contentCenterY = (minY + maxY) / 2;

        // 设置缩放为 100%
        const newZoom = 1.0;
        setZoom(newZoom);

        // 视口变换公式：screen = zoom * (world + pan)
        // 要让内容中心显示在屏幕中心：
        // screenCenterX = newZoom * (contentCenterX + panX)
        // panX = screenCenterX / newZoom - contentCenterX
        const newPanX = metrics.centerX / newZoom - contentCenterX;
        const newPanY = metrics.centerY / newZoom - contentCenterY;

        setPan(newPanX, newPanY);
        setMenuOpen(false);
    };

    // 适合屏幕：计算所有元素边界并自适应缩放
    const fitToScreen = useCallback(() => {
        fitBoundsToView(getAllContentBounds(), { fallbackToCenter: true });
    }, []);

    const fitToSelection = useCallback(() => {
        fitBoundsToView(getSelectedContentBounds(), { fallbackToCenter: false });
    }, []);

    useEffect(() => {
        const isEditableTarget = (target: EventTarget | null): boolean => {
            if (!(target instanceof HTMLElement)) return false;
            const tag = target.tagName;
            return (
                target.isContentEditable ||
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                tag === 'SELECT'
            );
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.repeat) return;
            if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            if (isEditableTarget(event.target)) return;
            if (event.key !== 'z' && event.key !== 'Z') return;

            event.preventDefault();
            const selectedBounds = getSelectedContentBounds();
            if (selectedBounds.length > 0) {
                fitBoundsToView(selectedBounds, { fallbackToCenter: false });
                return;
            }
            fitBoundsToView(getAllContentBounds(), { fallbackToCenter: true });
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fitToSelection]);

    // 检查是否到达边界
    const currentPercent = Math.round(zoom * 100);
    const canZoomIn = currentPercent < 400;
    const canZoomOut = currentPercent > 10;

    return (
        <div className="fixed left-[12px] bottom-2 z-10">
            <div className="flex flex-col items-center gap-1 px-1 py-1 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass">
                {/* 放大按钮 */}
                <Button
                    variant="outline"
                    size="sm"
                    className={`h-8 w-8 p-0 rounded-full transition-all duration-200 flex items-center justify-center bg-white/50 border-gray-300 ${
                        !canZoomIn
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-gray-800/10 hover:border-gray-800/20 hover:text-gray-900'
                    }`}
                    onClick={zoomIn}
                    disabled={!canZoomIn}
                    title={canZoomIn ? "放大 10%" : "已达最大缩放 (400%)"}
                >
                    <span className="text-sm font-bold">+</span>
                </Button>

                {/* 缩放百分比 - 点击弹出菜单 */}
                <div className="relative" ref={menuRef}>
                    <button
                        className="h-8 w-8 text-xs font-mono font-medium transition-all duration-200 rounded-full flex items-center justify-center text-gray-900 hover:bg-gray-800/10"
                        onClick={() => setMenuOpen(!menuOpen)}
                        title="缩放选项"
                    >
                        {formatZoom(zoom)}
                    </button>

                    {/* 下拉菜单 */}
                    {menuOpen && (
                        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-40 bg-white/95 backdrop-blur-md rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                            <button
                                className="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
                                onClick={resetZoom}
                            >
                                缩放至 100%
                            </button>
                            <button
                                className="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
                                onClick={fitToScreen}
                            >
                                适合屏幕
                            </button>
                            <button
                                className="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
                                onClick={fitToSelection}
                            >
                                选中内容最大化 (Z)
                            </button>
                        </div>
                    )}
                </div>

                {/* 缩小按钮 */}
                <Button
                    variant="outline"
                    size="sm"
                    className={`h-8 w-8 p-0 rounded-full transition-all duration-200 flex items-center justify-center bg-white/50 border-gray-300 ${
                        !canZoomOut
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-gray-800/10 hover:border-gray-800/20 hover:text-gray-900'
                    }`}
                    onClick={zoomOut}
                    disabled={!canZoomOut}
                    title={canZoomOut ? "缩小 10%" : "已达最小缩放 (10%)"}
                >
                    <span className="text-sm font-bold">−</span>
                </Button>
            </div>
        </div>
    );
};

export default ZoomIndicator;
