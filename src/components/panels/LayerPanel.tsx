import React, { useMemo, useRef, useState } from 'react';
import paper from 'paper';
import { Button } from '../ui/button';
import { X, Plus, Eye, EyeOff, Trash2, Lock, Unlock } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useLayerStore } from '@/stores';

const LayerPanel: React.FC = () => {
    const { showLayerPanel, setShowLayerPanel } = useUIStore();
    const { layers, activeLayerId, createLayer, deleteLayer, toggleVisibility, activateLayer, renameLayer, toggleLocked, reorderLayer } = useLayerStore();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below'>('above');
    const [indicatorY, setIndicatorY] = useState<number | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);


    const containerRef = useRef<HTMLDivElement | null>(null);
    const indicatorClass = useMemo(() => 'absolute left-3 right-3 h-0.5 bg-blue-500 rounded-full pointer-events-none', []);

    const generateLayerThumb = (id: string): string | null => {
        try {
            if (!paper.project) return null;
            const pl = paper.project.layers.find(l => l.name === `layer_${id}`);
            if (!pl || !pl.children || pl.children.length === 0) {
                return null;
            }

            // 保存当前活动图层
            const originalActiveLayer = paper.project.activeLayer;

            try {
                // 激活目标图层
                pl.activate();

                // 获取设备像素比，支持高DPI屏幕
                const dpr = window.devicePixelRatio || 1;
                const baseSize = 64;
                const renderSize = baseSize * dpr;

                // 使用 Paper.js 的 rasterize 方法，提高分辨率
                const raster = pl.rasterize({
                    resolution: 144 * dpr, // 提高分辨率
                    insert: false
                });

                if (!raster) return null;

                // 获取 canvas
                const sourceCanvas = (raster as any).canvas;
                if (!sourceCanvas) {
                    raster.remove();
                    return null;
                }

                // 创建高分辨率缩略图 canvas
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = renderSize;
                thumbCanvas.height = renderSize;
                const ctx = thumbCanvas.getContext('2d');
                if (!ctx) {
                    raster.remove();
                    return null;
                }

                // 开启抗锯齿
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                // 白色背景
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, renderSize, renderSize);

                // 添加边框
                ctx.strokeStyle = '#e5e7eb';
                ctx.lineWidth = dpr;
                ctx.strokeRect(0, 0, renderSize, renderSize);

                // 计算缩放和居中
                const bounds = raster.bounds;
                const padding = 4 * dpr; // 内边距
                const availableSize = renderSize - padding * 2;
                const scale = Math.min(availableSize / bounds.width, availableSize / bounds.height, 1);
                const scaledWidth = bounds.width * scale;
                const scaledHeight = bounds.height * scale;
                const x = (renderSize - scaledWidth) / 2;
                const y = (renderSize - scaledHeight) / 2;

                // 绘制缩略图
                ctx.drawImage(sourceCanvas, x, y, scaledWidth, scaledHeight);

                // 清理 raster
                raster.remove();

                // 返回 data URL，使用高质量 PNG
                return thumbCanvas.toDataURL('image/png', 1.0);
            } finally {
                // 恢复原始活动图层
                if (originalActiveLayer && originalActiveLayer !== pl) {
                    originalActiveLayer.activate();
                }
            }
        } catch (e) {
            console.error(`生成图层 ${id} 缩略图失败:`, e);
            return null;
        }
    };

    // 缓存缩略图，避免重复生成
    const thumbCache = useRef<Record<string, { dataUrl: string; timestamp: number }>>({});

    const getCachedThumb = (id: string): string | null => {
        const cached = thumbCache.current[id];
        const now = Date.now();

        // refreshTrigger 变化时会触发重新渲染

        // 缓存 1 秒
        if (cached && (now - cached.timestamp) < 1000) {
            return cached.dataUrl;
        }

        const newThumb = generateLayerThumb(id);
        if (newThumb) {
            thumbCache.current[id] = { dataUrl: newThumb, timestamp: now };
            return newThumb;
        }

        return null;
    };

    // 定期刷新缩略图
    React.useEffect(() => {
        if (!showLayerPanel) return;

        const interval = setInterval(() => {
            // 清空缓存并触发重新渲染
            thumbCache.current = {};
            setRefreshTrigger(prev => prev + 1);
        }, 1000); // 每秒刷新一次

        return () => clearInterval(interval);
    }, [showLayerPanel]);

    const startEditing = (id: string, currentName: string) => {
        setEditingId(id);
        setEditingName(currentName);
    };

    const commitEditing = () => {
        if (editingId) {
            const name = editingName.trim();
            if (name) renameLayer(editingId, name);
        }
        setEditingId(null);
        setEditingName('');
    };

    const handleClose = () => {
        setShowLayerPanel(false);
    };

    if (!showLayerPanel) return null;

    return (
        <div
            className={`fixed top-[41px] left-0 h-[calc(100vh-41px)] w-80 bg-white shadow-2xl z-[1000] transform transition-transform duration-300 ease-in-out ${showLayerPanel ? 'translate-x-0' : '-translate-x-full'
                }`}
        >
            {/* 面板头部 */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800">图层面板</h2>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleClose}
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* 工具栏 */}
            <div className="p-3 border-b border-gray-100">
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => createLayer(undefined, true)}
                >
                    <Plus className="h-4 w-4" />
                    新建图层
                </Button>
            </div>

            {/* 图层列表 */}
            <div className="flex-1 overflow-y-auto">
                <div ref={containerRef} className="relative p-3 space-y-2">
                    {layers.map(layer => (
                        <div
                            key={layer.id}
                            className={`flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 group ${activeLayerId === layer.id ? 'bg-blue-50 border border-blue-200' : ''}`}
                            onClick={() => activateLayer(layer.id)}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData('text/layer-id', layer.id); e.dataTransfer.effectAllowed = 'move'; setDragOverPosition('above'); }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                const middle = rect.top + rect.height / 2;
                                const pos: 'above' | 'below' = e.clientY < middle ? 'above' : 'below';
                                setDragOverPosition(pos);
                                if (containerRef.current) {
                                    const cRect = containerRef.current.getBoundingClientRect();
                                    const edge = pos === 'above' ? rect.top : rect.bottom;
                                    const y = edge - cRect.top + containerRef.current.scrollTop;
                                    setIndicatorY(y);
                                }
                            }}
                            onDragLeave={() => { setIndicatorY(null); }}
                            onDrop={(e) => {
                                e.preventDefault();
                                const sourceId = e.dataTransfer.getData('text/layer-id');
                                if (sourceId) reorderLayer(sourceId, layer.id, dragOverPosition === 'above');
                                setIndicatorY(null);
                            }}
                        >
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={(e) => { e.stopPropagation(); toggleVisibility(layer.id); }}
                                title={layer.visible ? '隐藏' : '显示'}
                            >
                                {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-gray-400" />}
                            </Button>
                            <div className="flex-1 min-w-0 flex items-center gap-2" onDoubleClick={(e) => { e.stopPropagation(); startEditing(layer.id, layer.name); }}>
                                {/* 缩略图 */}
                                <div className="shrink-0 w-8 h-8 border rounded bg-white overflow-hidden flex items-center justify-center">
                                    {(() => {
                                        const thumbUrl = getCachedThumb(layer.id);
                                        return thumbUrl ? (
                                            <img
                                                key={`${layer.id}_${refreshTrigger}`}
                                                src={thumbUrl}
                                                alt="thumb"
                                                className="w-8 h-8 object-contain"
                                                style={{ imageRendering: 'crisp-edges' }}
                                            />
                                        ) : (
                                            <div className="w-8 h-8 bg-gray-50 border border-gray-200 rounded flex items-center justify-center">
                                                <div className="w-4 h-4 bg-gray-200 rounded" />
                                            </div>
                                        );
                                    })()}
                                </div>
                                {editingId === layer.id ? (
                                    <input
                                        className="w-full text-sm font-medium px-2 py-1 border rounded outline-none focus:ring"
                                        autoFocus
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        onBlur={commitEditing}
                                        onKeyDown={(e) => { if (e.key === 'Enter') commitEditing(); if (e.key === 'Escape') { setEditingId(null); setEditingName(''); } }}
                                    />
                                ) : (
                                    <div className={`text-sm font-medium truncate ${layer.visible ? 'text-gray-900' : 'text-gray-500'}`}>
                                        {layer.name}
                                    </div>
                                )}
                                <div className="text-xs text-gray-500">
                                    {activeLayerId === layer.id ? '当前活动' : ' '}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={(e) => { e.stopPropagation(); toggleLocked(layer.id); }}
                                    title={layer.locked ? '解锁' : '锁定'}
                                >
                                    {layer.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                                </Button>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}
                                title="删除图层"
                            >
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    ))}
                    {indicatorY !== null && (
                        <div className={indicatorClass} style={{ top: indicatorY }} />
                    )}
                </div>
            </div>

            {/* 面板底部 */}
            <div className="p-3 border-t border-gray-200">
                <div className="text-xs text-gray-500 text-center">共 {layers.length} 个图层</div>
            </div>
        </div>
    );
};

export default LayerPanel;
