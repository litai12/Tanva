import React, { useMemo, useRef, useState, useEffect } from 'react';
import paper from 'paper';
import { Button } from '../ui/button';
import { X, Plus, Eye, EyeOff, Trash2, Lock, Unlock, ChevronRight, ChevronDown, Circle, Square, Minus, Image, Box } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useLayerStore } from '@/stores';

interface LayerItemData {
    id: string;
    name: string;
    type: 'path' | 'circle' | 'rectangle' | 'line' | 'image' | 'model3d' | 'group';
    visible: boolean;
    locked: boolean;
    selected: boolean;
    paperItem?: paper.Item;
}

const LayerPanel: React.FC = () => {
    const { showLayerPanel, setShowLayerPanel } = useUIStore();
    const { layers, activeLayerId, createLayer, deleteLayer, toggleVisibility, activateLayer, renameLayer, toggleLocked, reorderLayer } = useLayerStore();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below'>('above');
    const [indicatorY, setIndicatorY] = useState<number | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
    const [layerItems, setLayerItems] = useState<Record<string, LayerItemData[]>>({});
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const indicatorClass = useMemo(() => 'absolute left-3 right-3 h-0.5 bg-blue-500 rounded-full pointer-events-none', []);

    // 扫描图层中的所有图元
    const scanLayerItems = (layerId: string): LayerItemData[] => {
        if (!paper.project) return [];

        const layer = paper.project.layers.find(l => l.name === `layer_${layerId}`);
        if (!layer) return [];

        const items: LayerItemData[] = [];

        layer.children.forEach((item, index) => {
            // 跳过辅助元素
            if (item.data?.isHelper || item.data?.type === 'grid' || item.data?.type === 'scalebar') {
                return;
            }

            let type: LayerItemData['type'] = 'path';
            let name = `图元 ${index + 1}`;

            if (item instanceof paper.Path) {
                if (item instanceof paper.Path.Circle) {
                    type = 'circle';
                    name = `圆形 ${index + 1}`;
                } else if (item instanceof paper.Path.Rectangle) {
                    type = 'rectangle';
                    name = `矩形 ${index + 1}`;
                } else if (item instanceof paper.Path.Line) {
                    type = 'line';
                    name = `直线 ${index + 1}`;
                } else {
                    name = `路径 ${index + 1}`;
                }
            } else if (item instanceof paper.Group) {
                if (item.data?.type === 'image') {
                    type = 'image';
                    name = `图片 ${index + 1}`;
                } else if (item.data?.type === '3d-model') {
                    type = 'model3d';
                    name = `3D模型 ${index + 1}`;
                } else if (item.data?.type === 'image-placeholder') {
                    // 占位符不应该显示，但以防万一
                    return;
                } else if (item.data?.type === 'model3d-placeholder') {
                    // 占位符不应该显示，但以防万一
                    return;
                } else {
                    type = 'group';
                    name = `组 ${index + 1}`;
                }
            }

            // 如果图元有自定义名称，使用它
            if (item.data?.customName) {
                name = item.data.customName;
            }

            items.push({
                id: `${layerId}_item_${item.id}`,
                name,
                type,
                visible: item.visible,
                locked: item.locked || false,
                selected: item.selected || false,
                paperItem: item
            });
        });

        return items;
    };

    // 更新所有图层的图元
    const updateAllLayerItems = () => {
        const newLayerItems: Record<string, LayerItemData[]> = {};
        layers.forEach(layer => {
            newLayerItems[layer.id] = scanLayerItems(layer.id);
        });
        setLayerItems(newLayerItems);
    };

    // 监听 Paper.js 的变化
    useEffect(() => {
        if (!paper.project || !showLayerPanel) return;

        let lastUpdateTime = 0;
        const throttleDelay = 100; // 节流延迟

        const handleChange = () => {
            const now = Date.now();
            if (now - lastUpdateTime > throttleDelay) {
                updateAllLayerItems();
                setRefreshTrigger(prev => prev + 1);
                lastUpdateTime = now;
            }
        };

        // 监听项目变化
        paper.project.on('change', handleChange);

        // 初始扫描
        updateAllLayerItems();

        // 设置定期更新，但频率降低
        const updateInterval = setInterval(() => {
            updateAllLayerItems();
            setRefreshTrigger(prev => prev + 1);
        }, 500); // 每500ms检查一次，减少性能开销

        return () => {
            paper.project.off('change', handleChange);
            clearInterval(updateInterval);
        };
    }, [showLayerPanel, layers]);

    const generateLayerThumb = (id: string): string | null => {
        try {
            if (!paper.project) return null;
            const pl = paper.project.layers.find(l => l.name === `layer_${id}`);
            if (!pl || !pl.children || pl.children.length === 0) {
                return null;
            }

            // 保存当前活动图层和可见性状态
            const originalActiveLayer = paper.project.activeLayer;
            const helperVisibilityStates = new Map<paper.Item, boolean>();

            try {
                // 激活目标图层
                pl.activate();

                // 临时隐藏所有辅助元素
                paper.project.layers.forEach(layer => {
                    layer.children.forEach(item => {
                        if (item.data?.isHelper || item.data?.type === 'grid' || item.data?.type === 'scalebar' ||
                            layer.name === 'grid' || layer.name === 'scalebar' || layer.name === 'background') {
                            helperVisibilityStates.set(item, item.visible);
                            item.visible = false;
                        }
                    });
                });

                // 获取设备像素比，支持高DPI屏幕
                const dpr = window.devicePixelRatio || 1;
                const baseSize = 64;
                const renderSize = baseSize * dpr;

                // 只渲染当前图层的内容
                const items = pl.children.filter(item =>
                    !item.data?.isHelper &&
                    item.data?.type !== 'grid' &&
                    item.data?.type !== 'scalebar'
                );

                if (items.length === 0) {
                    // 恢复辅助元素的可见性
                    helperVisibilityStates.forEach((visible, item) => {
                        item.visible = visible;
                    });
                    return null;
                }

                // 计算所有图元的边界
                let bounds = null;
                items.forEach(item => {
                    if (item.visible && item.bounds.width > 0 && item.bounds.height > 0) {
                        bounds = bounds ? bounds.unite(item.bounds) : item.bounds.clone();
                    }
                });

                if (!bounds || bounds.width === 0 || bounds.height === 0) {
                    // 恢复辅助元素的可见性
                    helperVisibilityStates.forEach((visible, item) => {
                        item.visible = visible;
                    });
                    return null;
                }

                // 创建临时组并栅格化
                const tempGroup = new paper.Group(items.map(item => item.clone({ deep: true, insert: false })));
                tempGroup.bounds = bounds;

                const raster = tempGroup.rasterize({
                    resolution: 144 * dpr,
                    insert: false
                });

                if (!raster) {
                    tempGroup.remove();
                    // 恢复辅助元素的可见性
                    helperVisibilityStates.forEach((visible, item) => {
                        item.visible = visible;
                    });
                    return null;
                }

                // 获取 canvas
                const sourceCanvas = (raster as any).canvas;
                if (!sourceCanvas) {
                    raster.remove();
                    tempGroup.remove();
                    // 恢复辅助元素的可见性
                    helperVisibilityStates.forEach((visible, item) => {
                        item.visible = visible;
                    });
                    return null;
                }

                // 创建高分辨率缩略图 canvas
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = renderSize;
                thumbCanvas.height = renderSize;
                const ctx = thumbCanvas.getContext('2d');
                if (!ctx) {
                    raster.remove();
                    tempGroup.remove();
                    // 恢复辅助元素的可见性
                    helperVisibilityStates.forEach((visible, item) => {
                        item.visible = visible;
                    });
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
                const padding = 4 * dpr;
                const availableSize = renderSize - padding * 2;
                const scale = Math.min(availableSize / bounds.width, availableSize / bounds.height, 1);
                const scaledWidth = bounds.width * scale;
                const scaledHeight = bounds.height * scale;
                const x = (renderSize - scaledWidth) / 2;
                const y = (renderSize - scaledHeight) / 2;

                // 绘制缩略图
                ctx.drawImage(sourceCanvas, x, y, scaledWidth, scaledHeight);

                // 清理
                raster.remove();
                tempGroup.remove();

                // 恢复辅助元素的可见性
                helperVisibilityStates.forEach((visible, item) => {
                    item.visible = visible;
                });

                // 返回 data URL
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

    // 缓存缩略图
    const thumbCache = useRef<Record<string, { dataUrl: string; timestamp: number }>>({});

    const getCachedThumb = (id: string): string | null => {
        const cached = thumbCache.current[id];
        const now = Date.now();

        // 缓存 1秒，避免过于频繁的生成
        if (cached && (now - cached.timestamp) < 1000) {
            return cached.dataUrl;
        }

        // 检查是否有内容再生成缩略图
        const items = layerItems[id] || [];
        if (items.length === 0) {
            return null; // 空图层不生成缩略图
        }

        const newThumb = generateLayerThumb(id);
        if (newThumb) {
            thumbCache.current[id] = { dataUrl: newThumb, timestamp: now };
            return newThumb;
        }

        return null;
    };

    // 定期刷新缩略图
    useEffect(() => {
        if (!showLayerPanel) return;

        const interval = setInterval(() => {
            // 清空缓存并触发重新渲染
            thumbCache.current = {};
            setRefreshTrigger(prev => prev + 1);
        }, 500); // 每500ms刷新一次，更及时

        return () => clearInterval(interval);
    }, [showLayerPanel]);

    const toggleLayerExpanded = (layerId: string) => {
        setExpandedLayers(prev => {
            const newSet = new Set(prev);
            if (newSet.has(layerId)) {
                newSet.delete(layerId);
            } else {
                newSet.add(layerId);
            }
            return newSet;
        });
    };

    const handleItemClick = (item: LayerItemData, layerId: string) => {
        setSelectedItemId(item.id);
        // 选中对应的 Paper.js 图元
        if (item.paperItem) {
            paper.project.deselectAll();
            item.paperItem.selected = true;
        }
    };

    const handleItemVisibilityToggle = (item: LayerItemData, e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.paperItem) {
            item.paperItem.visible = !item.paperItem.visible;
            updateAllLayerItems();
        }
    };

    const handleItemLockToggle = (item: LayerItemData, e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.paperItem) {
            item.paperItem.locked = !item.paperItem.locked;
            updateAllLayerItems();
        }
    };

    const handleItemDelete = (item: LayerItemData, e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.paperItem && window.confirm('确定要删除这个图元吗？')) {
            // 如果是图片或3D模型组，需要额外清理
            if (item.type === 'image' || item.type === 'model3d') {
                const itemData = item.paperItem.data;
                const targetId = itemData?.imageId || itemData?.modelId;
                
                if (targetId) {
                    // 查找并删除关联的选择区域
                    paper.project.layers.forEach(layer => {
                        layer.children.forEach(child => {
                            if (child.data?.type === 'image-selection-area' && child.data?.imageId === targetId) {
                                child.remove();
                            } else if (child.data?.type === '3d-model-selection-area' && child.data?.modelId === targetId) {
                                child.remove();
                            }
                        });
                    });
                }
            }
            
            item.paperItem.remove();
            updateAllLayerItems();
        }
    };

    const getItemIcon = (type: LayerItemData['type']) => {
        switch (type) {
            case 'circle':
                return <Circle className="w-3 h-3" />;
            case 'rectangle':
                return <Square className="w-3 h-3" />;
            case 'line':
                return <Minus className="w-3 h-3" />;
            case 'image':
                return <Image className="w-3 h-3" />;
            case 'model3d':
                return <Box className="w-3 h-3" />;
            default:
                return null;
        }
    };

    const startEditing = (id: string, currentName: string) => {
        setEditingId(id);
        setEditingName(currentName);
    };

    const commitEditing = () => {
        if (editingId) {
            const name = editingName.trim();
            if (name) {
                // 如果是图元，更新其自定义名称
                if (editingId.includes('_item_')) {
                    const item = Object.values(layerItems).flat().find(item => item.id === editingId);
                    if (item?.paperItem) {
                        item.paperItem.data = { ...item.paperItem.data, customName: name };
                        updateAllLayerItems();
                    }
                } else {
                    // 如果是图层，使用原有的重命名功能
                    renameLayer(editingId, name);
                }
            }
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
                <h2 className="text-lg font-semibold text-gray-800">图层</h2>
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
                    {layers.map(layer => {
                        const isExpanded = expandedLayers.has(layer.id);
                        const items = layerItems[layer.id] || [];

                        return (
                            <div key={layer.id}>
                                {/* 图层项 */}
                                <div
                                    className={`flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 group ${activeLayerId === layer.id ? 'bg-blue-50 border border-blue-200' : ''}`}
                                    onClick={() => activateLayer(layer.id)}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/layer-id', layer.id);
                                        e.dataTransfer.effectAllowed = 'move';
                                        setDragOverPosition('above');
                                    }}
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
                                    {/* 展开/折叠按钮 */}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-4 w-4 p-0"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleLayerExpanded(layer.id);
                                        }}
                                    >
                                        {items.length > 0 && (
                                            isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                                        )}
                                        {items.length === 0 && <div className="w-3" />}
                                    </Button>

                                    {/* 可见性按钮 */}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={(e) => { e.stopPropagation(); toggleVisibility(layer.id); }}
                                        title={layer.visible ? '隐藏' : '显示'}
                                    >
                                        {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-gray-400" />}
                                    </Button>

                                    <div className="flex-1 min-w-0 flex items-center gap-2" onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        startEditing(layer.id, layer.name);
                                    }}>
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
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') commitEditing();
                                                    if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                                                }}
                                            />
                                        ) : (
                                            <div className={`text-sm font-medium truncate ${layer.visible ? 'text-gray-900' : 'text-gray-500'}`}>
                                                {layer.name}
                                            </div>
                                        )}

                                        <div className="text-xs text-gray-500">
                                            {items.length > 0 && `(${items.length})`}
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

                                {/* 图层内的图元列表 */}
                                {isExpanded && items.length > 0 && (
                                    <div className="ml-6 mt-1 space-y-1">
                                        {items.map(item => (
                                            <div
                                                key={item.id}
                                                className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 group cursor-pointer ${selectedItemId === item.id ? 'bg-blue-50' : ''
                                                    }`}
                                                onClick={() => handleItemClick(item, layer.id)}
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    startEditing(item.id, item.name);
                                                }}
                                            >
                                                {/* 图元图标 */}
                                                <div className="w-4 h-4 flex items-center justify-center text-gray-400">
                                                    {getItemIcon(item.type)}
                                                </div>

                                                {/* 可见性按钮 */}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-4 w-4 p-0"
                                                    onClick={(e) => handleItemVisibilityToggle(item, e)}
                                                    title={item.visible ? '隐藏' : '显示'}
                                                >
                                                    {item.visible ?
                                                        <Eye className="h-3 w-3" /> :
                                                        <EyeOff className="h-3 w-3 text-gray-400" />
                                                    }
                                                </Button>

                                                {/* 图元名称 */}
                                                {editingId === item.id ? (
                                                    <input
                                                        className="flex-1 text-xs px-1 py-0.5 border rounded outline-none focus:ring"
                                                        autoFocus
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        onBlur={commitEditing}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') commitEditing();
                                                            if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <div className={`flex-1 text-xs truncate ${item.visible ? 'text-gray-700' : 'text-gray-400'
                                                        }`}>
                                                        {item.name}
                                                    </div>
                                                )}

                                                {/* 操作按钮 */}
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-4 w-4 p-0"
                                                        onClick={(e) => handleItemLockToggle(item, e)}
                                                        title={item.locked ? '解锁' : '锁定'}
                                                    >
                                                        {item.locked ?
                                                            <Lock className="h-2 w-2" /> :
                                                            <Unlock className="h-2 w-2" />
                                                        }
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-4 w-4 p-0"
                                                        onClick={(e) => handleItemDelete(item, e)}
                                                        title="删除"
                                                    >
                                                        <Trash2 className="h-2 w-2" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {indicatorY !== null && (
                        <div className={indicatorClass} style={{ top: indicatorY }} />
                    )}
                </div>
            </div>

            {/* 面板底部 */}
            <div className="p-3 border-t border-gray-200">
                <div className="text-xs text-gray-500 text-center">
                    共 {layers.length} 个图层，
                    {Object.values(layerItems).flat().length} 个图元
                </div>
            </div>
        </div>
    );
};

export default LayerPanel;