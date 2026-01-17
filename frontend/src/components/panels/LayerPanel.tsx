// @ts-nocheck
import { logger } from '@/utils/logger';
import React, { useMemo, useRef, useState, useEffect } from 'react';
import paper from 'paper';
import { Button } from '../ui/button';
import { X, Plus, Eye, EyeOff, Trash2, Lock, Unlock, ChevronLeft, ChevronRight, ChevronDown, Circle, Square, Minus, Image, Box, Pen, Sparkles } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useLayerStore } from '@/stores';
import { useAIChatStore } from '@/stores/aiChatStore';
import ContextMenu from '../ui/context-menu';
import { isRaster } from '@/utils/paperCoords';
import { canvasToDataUrl } from '@/utils/imageConcurrency';

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
    const { showLayerPanel, setShowLayerPanel, focusMode } = useUIStore();
    const { layers, activeLayerId, createLayer, deleteLayer, toggleVisibility, activateLayer, renameLayer, toggleLocked, reorderLayer } = useLayerStore();
    const { setSourceImageForEditing, showDialog } = useAIChatStore();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below'>('above');
    const [indicatorY, setIndicatorY] = useState<number | null>(null);
    const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
    const [itemIndicatorY, setItemIndicatorY] = useState<number | null>(null);
    const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

    // 上下文菜单状态
    const [contextMenu, setContextMenu] = useState<{
        visible: boolean;
        x: number;
        y: number;
        item: LayerItemData | null;
    }>({
        visible: false,
        x: 0,
        y: 0,
        item: null
    });

    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
    const [layerItems, setLayerItems] = useState<Record<string, LayerItemData[]>>({});
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [isInitialLoading, setIsInitialLoading] = useState(true);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const indicatorClass = useMemo(() => 'absolute left-3 right-3 h-0.5 bg-gray-800 rounded-full pointer-events-none', []);
    // 缓存缩略图
    const thumbCache = useRef<Record<string, { dataUrl: string; timestamp: number }>>({});
    // 异步缩略图生成队列
    const thumbGenerationQueue = useRef<Set<string>>(new Set());
    const isGeneratingThumb = useRef(false);

    // 预测图元重排序后的实际位置，用于指示线显示
    const predictItemInsertPosition = (sourceItemId: string, targetItemId: string, placeAbove: boolean) => {
        // 获取图层ID
        const targetLayerId = targetItemId.split('_item_')[0];
        const items = layerItems[targetLayerId] || [];

        if (items.length === 0) return -1;

        const sourceItem = Object.values(layerItems).flat().find(item => item.id === sourceItemId);
        const targetItem = items.find(item => item.id === targetItemId);

        if (!sourceItem || !targetItem) return -1;

        // 在Paper.js中，顺序是相反的（显示时已反转）
        // placeAbove=true意味着在视觉上放在上方，但在Paper.js中是insertBelow
        const targetIndex = items.findIndex(item => item.id === targetItemId);

        // 现在插入逻辑已修正，预测最终的显示位置
        // 注意：由于scanLayerItems中对items进行了reverse()，
        // insertAbove实际上会让元素在列表中显示在上方
        if (placeAbove) {
            return targetIndex; // insertAbove：放在目标项上方（在列表中显示在上面）
        } else {
            return targetIndex + 1; // insertBelow：放在目标项下方（在列表中显示在下面）
        }
    };

    // 预测图层重排序后的实际位置，用于指示线显示
    const predictInsertPosition = (sourceId: string, targetId: string, placeAbove: boolean) => {
        const sourceIndex = layers.findIndex(l => l.id === sourceId);
        const targetIndex = layers.findIndex(l => l.id === targetId);

        if (sourceIndex === -1 || targetIndex === -1) return -1;

        // 完全复制 reorderLayer 的逻辑
        // 注意：targetIndex 是原始数组中的位置，但插入操作发生在移除源元素后的数组中
        let insertIndex = targetIndex;
        if (sourceIndex < targetIndex) {
            // 源在目标前：移除源元素后，原本在 targetIndex 的元素现在在 targetIndex-1
            // placeAbove=true: 插入到 targetIndex-1 位置（目标元素前）
            // placeAbove=false: 插入到 targetIndex 位置（目标元素后）
            insertIndex = placeAbove ? targetIndex - 1 : targetIndex;
        } else {
            // 源在目标后或相同：移除源元素不影响目标元素位置
            // placeAbove=true: 插入到 targetIndex 位置（目标元素前）
            // placeAbove=false: 插入到 targetIndex+1 位置（目标元素后）
            insertIndex = placeAbove ? targetIndex : targetIndex + 1;
        }

        return insertIndex;
    };

    // 扫描图层中的所有图元
    const scanLayerItems = (layerId: string): LayerItemData[] => {
        if (!paper.project) return [];

        const layer = paper.project.layers.find(l => l.name === `layer_${layerId}`);
        if (!layer) {
            return [];
        }

        const items: LayerItemData[] = [];

        // 获取所有非辅助元素，并反转顺序
        const validItems = layer.children.filter(item => {
            const isHelper = item.data?.isHelper;
            const isGrid = item.data?.type === 'grid';
            const isScalebar = item.data?.type === 'scalebar';
            const isImageGroupBlock = item.data?.type === 'image-group';
            const isImageGroupTitle = item.data?.type === 'image-group-title';
            const shouldFilter = isHelper === true || isGrid || isScalebar || isImageGroupBlock || isImageGroupTitle;
            return !shouldFilter;
        }).reverse();

        // 预先计算每种类型的最大编号（O(n) 而非 O(n²)）
        const typeMaxNumbers: Record<string, number> = {};
        const typeNames: Record<string, string> = {
            'circle': '圆形',
            'rectangle': '矩形',
            'line': '直线',
            'path': '路径',
            'image': '图片',
            'model3d': '3D模型',
            'group': '组'
        };

        // 第一遍：收集已有的最大编号
        validItems.forEach(item => {
            if (item.data?.customName) {
                for (const [type, baseName] of Object.entries(typeNames)) {
                    const match = item.data.customName.match(new RegExp(`^${baseName}\\s*(\\d+)?$`));
                    if (match) {
                        const num = match[1] ? parseInt(match[1], 10) : 1;
                        typeMaxNumbers[type] = Math.max(typeMaxNumbers[type] || 0, num);
                        break;
                    }
                }
            }
        });

        // 第二遍：处理图元
        validItems.forEach((item) => {
            let type: LayerItemData['type'] = 'path';
            let name = '未命名图元';

            const isGroup = item.className === 'Group' || item instanceof paper.Group;
            const isPath = item.className === 'Path' || item instanceof paper.Path;

            if (isPath) {
                if (item instanceof paper.Path.Circle || item.className === 'Path' && (item as any)._class === 'Circle') {
                    type = 'circle';
                } else if (item instanceof paper.Path.Rectangle) {
                    type = 'rectangle';
                } else if (item instanceof paper.Path.Line) {
                    type = 'line';
                } else {
                    type = 'path';
                }
            } else if (isGroup) {
                if (item.data?.type === 'image') {
                    type = 'image';
                } else if (item.data?.type === '3d-model') {
                    type = 'model3d';
                } else if (item.data?.type === 'image-placeholder' || item.data?.type === 'model3d-placeholder') {
                    return;
                } else {
                    type = 'group';
                }
            }

            // 优先使用已有的自定义名称
            if (item.data?.customName) {
                name = item.data.customName;
            } else {
                const baseName = typeNames[type] || '图元';
                // 直接使用预计算的最大编号 + 1
                typeMaxNumbers[type] = (typeMaxNumbers[type] || 0) + 1;
                const nextNumber = typeMaxNumbers[type];
                name = nextNumber === 1 ? baseName : `${baseName} ${nextNumber}`;

                // 将名称保存到图元的data中
                if (!item.data) {
                    item.data = {};
                }
                item.data.customName = name;
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
            const items = scanLayerItems(layer.id);
            newLayerItems[layer.id] = items;
        });
        setLayerItems(newLayerItems);
    };

    // 监听 Paper.js 的变化
    useEffect(() => {
        if (!paper.project || !showLayerPanel) {
            setIsInitialLoading(true);
            return;
        }

        let lastUpdateTime = 0;
        const throttleDelay = 500;
        let pendingUpdate = false;

        const handleChange = () => {
            const now = Date.now();
            if (now - lastUpdateTime > throttleDelay) {
                updateAllLayerItems();
                lastUpdateTime = now;
                pendingUpdate = false;
            } else if (!pendingUpdate) {
                pendingUpdate = true;
                setTimeout(() => {
                    updateAllLayerItems();
                    lastUpdateTime = Date.now();
                    pendingUpdate = false;
                }, throttleDelay);
            }
        };

        paper.project.on('change', handleChange);

        // 异步初始扫描 - 让面板先渲染再加载数据
        requestAnimationFrame(() => {
            updateAllLayerItems();
            setIsInitialLoading(false);
        });

        const updateInterval = setInterval(() => {
            updateAllLayerItems();
        }, 5000);

        return () => {
            paper.project.off('change', handleChange);
            clearInterval(updateInterval);
        };
    }, [showLayerPanel, layers]);

    const generateLayerThumb = async (id: string): Promise<string | null> => {
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

                // 返回 data URL，处理跨域污染错误
                try {
                    return await canvasToDataUrl(thumbCanvas, 'image/png', 1.0);
                } catch (e) {
                    // SecurityError: canvas 被跨域图片污染，无法导出
                    if (e instanceof SecurityError || 
                        (e instanceof Error && (
                            e.message.includes('insecure') || 
                            e.message.includes('Tainted') ||
                            e.message.includes('tainted')
                        ))) {
                        logger.debug(`图层 ${id} 包含跨域图片，无法生成缩略图`);
                        return null;
                    }
                    // 其他错误继续抛出，由外层 catch 处理
                    throw e;
                }
            } finally {
                // 恢复原始活动图层
                if (originalActiveLayer && originalActiveLayer !== pl) {
                    originalActiveLayer.activate();
                }
            }
        } catch (e) {
            // 跨域污染错误只打印一次警告，避免刷屏
            if (e instanceof SecurityError || 
                (e instanceof Error && (
                    e.message.includes('insecure') || 
                    e.message.includes('Tainted') ||
                    e.message.includes('tainted')
                ))) {
                logger.debug(`图层 ${id} 包含跨域图片，无法生成缩略图`);
            } else {
                console.error(`生成图层 ${id} 缩略图失败:`, e);
            }
            return null;
        }
    };

    // 生成图片缩略图
    const generateImageThumb = (imageItem: LayerItemData): string | null => {
        try {
            // 查找对应的图片实例
            const imageInstances = (window as any).tanvaImageInstances || [];
            const imageInstance = imageInstances.find((img: any) =>
                img.imageData?.src && imageItem.paperItem?.data?.imageId === img.id
            );

            if (imageInstance?.imageData?.src) {
                return imageInstance.imageData.url || imageInstance.imageData.src; // 直接返回图片数据
            }

            return null;
        } catch (e) {
            console.error('生成图片缩略图失败:', e);
            return null;
        }
    };

    // 生成3D模型缩略图 
    const generate3DModelThumb = async (modelItem: LayerItemData): Promise<string | null> => {
        try {
            // 查找对应的3D模型实例
            const model3DInstances = (window as any).tanvaModel3DInstances || [];
            const modelInstance = model3DInstances.find((model: any) =>
                modelItem.paperItem?.data?.modelId === model.id
            );

            logger.debug('查找3D模型实例:', {
                paperItemModelId: modelItem.paperItem?.data?.modelId,
                availableModels: model3DInstances.map((m: any) => ({ id: m.id, fileName: m.modelData?.fileName })),
                foundInstance: !!modelInstance
            });

            if (modelInstance?.modelData) {
                // 尝试获取3D模型的真实缩略图
                const realThumb = await capture3DModelThumbnail(modelInstance);
                if (realThumb) {
                    return realThumb;
                }

                // 回退到SVG占位符
                const svgThumb = createModel3DPlaceholderSVG(modelInstance.modelData.fileName || '3D模型');
                return svgThumb;
            }

            return null;
        } catch (e) {
            console.error('生成3D模型缩略图失败:', e);
            return null;
        }
    };

    // 捕获3D模型的真实缩略图
    const capture3DModelThumbnail = async (modelInstance: any): Promise<string | null> => {
        try {
            // 查找对应的3D容器DOM元素
            const modelContainers = document.querySelectorAll('[data-model-id]');
            let targetContainer: Element | null = null;

            logger.debug('查找DOM容器:', {
                searchingForId: modelInstance.id,
                availableContainers: Array.from(modelContainers).map(c => c.getAttribute('data-model-id'))
            });

            for (const container of modelContainers) {
                if (container.getAttribute('data-model-id') === modelInstance.id) {
                    targetContainer = container;
                    break;
                }
            }

            if (!targetContainer) {
                return null;
            }

            // 查找Three.js canvas元素
            const canvas = targetContainer.querySelector('canvas') as HTMLCanvasElement;
            if (!canvas) {
                return null;
            }

            // 检查canvas是否有有效内容（宽高和像素数据）
            if (canvas.width === 0 || canvas.height === 0) {
                return null;
            }

            // 创建缩略图canvas
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 32;
            thumbCanvas.height = 32;
            const thumbCtx = thumbCanvas.getContext('2d');

            if (!thumbCtx) {
                return null;
            }

            // 设置背景为透明
            thumbCtx.clearRect(0, 0, 32, 32);

            // 将3D渲染结果绘制到缩略图canvas，保持宽高比
            const aspectRatio = canvas.width / canvas.height;
            let drawWidth = 32;
            let drawHeight = 32;
            let offsetX = 0;
            let offsetY = 0;

            if (aspectRatio > 1) {
                drawHeight = 32 / aspectRatio;
                offsetY = (32 - drawHeight) / 2;
            } else {
                drawWidth = 32 * aspectRatio;
                offsetX = (32 - drawWidth) / 2;
            }

            thumbCtx.drawImage(canvas, offsetX, offsetY, drawWidth, drawHeight);

            // 转换为base64
            return await canvasToDataUrl(thumbCanvas, 'image/png');

        } catch (e) {
            console.error('捕获3D模型缩略图失败:', e);
            return null;
        }
    };

    // 创建3D模型占位符SVG
    const createModel3DPlaceholderSVG = (fileName: string): string => {
        const svg = `
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" fill="#f3f4f6" rx="4"/>
                <rect x="8" y="12" width="16" height="12" fill="#6b7280" rx="2" opacity="0.7"/>
                <rect x="6" y="10" width="16" height="12" fill="#4b5563" rx="2" opacity="0.8"/>
                <rect x="4" y="8" width="16" height="12" fill="#374151" rx="2"/>
                <text x="16" y="26" font-family="Arial, sans-serif" font-size="6" fill="#9ca3af" text-anchor="middle">3D</text>
            </svg>
        `;

        return `data:image/svg+xml;base64,${btoa(svg)}`;
    };

    // 异步生成缩略图
    const generateThumbAsync = (id: string) => {
        if (thumbGenerationQueue.current.has(id) || isGeneratingThumb.current) {
            return;
        }

        thumbGenerationQueue.current.add(id);

        const processQueue = () => {
            if (isGeneratingThumb.current || thumbGenerationQueue.current.size === 0) {
                return;
            }

            const nextId = thumbGenerationQueue.current.values().next().value;
            if (!nextId) return;

            thumbGenerationQueue.current.delete(nextId);
            isGeneratingThumb.current = true;

            requestAnimationFrame(() => {
                void (async () => {
                    const items = layerItems[nextId] || [];
                    let thumb: string | null = null;

                    if (items.length === 1) {
                        const item = items[0];
                        if (item.type === 'image') {
                            thumb = generateImageThumb(item);
                        } else if (item.type === 'model3d') {
                            thumb = await generate3DModelThumb(item);
                        }
                    }

                    if (!thumb) {
                        thumb = await generateLayerThumb(nextId);
                    }

                    // 无论成功还是失败都缓存结果，避免跨域污染导致的无限重试
                    // 失败时缓存空字符串，显示占位符
                    thumbCache.current[nextId] = {
                        dataUrl: thumb || '',
                        timestamp: Date.now()
                    };
                    if (thumb) {
                        setRefreshTrigger(prev => prev + 1);
                    }
                })()
                  .catch((e) => {
                      console.error('生成缩略图失败:', e);
                      thumbCache.current[nextId] = {
                          dataUrl: '',
                          timestamp: Date.now()
                      };
                  })
                  .finally(() => {
                      isGeneratingThumb.current = false;

                      // 处理队列中的下一个
                      if (thumbGenerationQueue.current.size > 0) {
                          setTimeout(processQueue, 16);
                      }
                  });
            });
        };

        processQueue();
    };

    const getCachedThumb = (id: string): string | null => {
        const cached = thumbCache.current[id];
        const now = Date.now();

        // 缓存 5秒
        if (cached && (now - cached.timestamp) < 5000) {
            return cached.dataUrl;
        }

        // 检查是否有内容
        const items = layerItems[id] || [];
        if (items.length === 0) {
            return null;
        }

        // 异步生成缩略图，先返回 null 显示占位符
        generateThumbAsync(id);
        return cached?.dataUrl || null;
    };

    // 定期刷新缩略图 - 改为5秒，并使用异步生成
    useEffect(() => {
        if (!showLayerPanel) return;

        const interval = setInterval(() => {
            // 只清空过期的缓存，不强制刷新所有
            const now = Date.now();
            const expiredIds: string[] = [];
            Object.entries(thumbCache.current).forEach(([id, cache]) => {
                if (now - cache.timestamp > 5000) {
                    expiredIds.push(id);
                }
            });
            expiredIds.forEach(id => delete thumbCache.current[id]);

            // 只有当有过期缓存时才触发重新渲染
            if (expiredIds.length > 0) {
                setRefreshTrigger(prev => prev + 1);
            }
        }, 5000);

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

        // 通过事件通知DrawingController进行统一的选择处理
        if (item.paperItem) {
            // 发送自定义事件到DrawingController
            const event = new CustomEvent('layerItemSelected', {
                detail: {
                    item: item.paperItem,
                    type: item.type,
                    itemId: item.id
                }
            });
            window.dispatchEvent(event);
        }
    };

    const handleItemVisibilityToggle = (item: LayerItemData, e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.paperItem) {
            item.paperItem.visible = !item.paperItem.visible;
            updateAllLayerItems();

            // 如果是图片或3D模型，触发同步事件
            if (item.type === 'image' || item.type === '3d-model') {
                window.dispatchEvent(new CustomEvent('layerVisibilityChanged'));
            }
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

    // 处理右键菜单
    const handleItemContextMenu = (item: LayerItemData, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            item: item
        });
    };

    // 处理AI编辑图像
    const handleAIEditImage = async (item: LayerItemData) => {
        if (item.type !== 'image' || !item.paperItem) return;

        try {
            // 找到图像的Raster对象
            const raster = item.paperItem.children?.find(child => isRaster(child)) as paper.Raster;
            if (raster && raster.canvas) {
                const imageData = await canvasToDataUrl(raster.canvas, 'image/png');
                setSourceImageForEditing(imageData);
                showDialog();
            }
        } catch (error) {
            console.error('获取图像数据失败:', error);
        }
    };

    // 图元重排序处理
    const handleItemReorder = (sourceItemId: string, targetItemId: string, placeAbove: boolean) => {
        // 解析图元ID获取Paper.js对象信息
        const sourceItem = Object.values(layerItems).flat().find(item => item.id === sourceItemId);
        const targetItem = Object.values(layerItems).flat().find(item => item.id === targetItemId);

        if (!sourceItem?.paperItem || !targetItem?.paperItem) {
            console.warn('无法找到对应的Paper.js对象');
            return;
        }

        // 获取源和目标的图层
        const sourceLayerId = sourceItemId.split('_item_')[0];
        const targetLayerId = targetItemId.split('_item_')[0];

        // 如果是跨图层移动
        if (sourceLayerId !== targetLayerId) {
            const targetLayer = paper.project.layers.find(l => l.name === `layer_${targetLayerId}`);
            if (targetLayer) {
                // 保存原始Paper.js项的引用
                const originalPaperItem = sourceItem.paperItem;
                
                // 移除源图元并添加到目标图层
                const clonedItem = sourceItem.paperItem.clone({
                    deep: true, // 深度克隆，确保所有数据都被复制
                    insert: false // 不自动插入，手动控制位置
                });
                
                // 确保数据完整复制
                if (originalPaperItem.data) {
                    clonedItem.data = { ...originalPaperItem.data };
                }
                
                sourceItem.paperItem.remove();
                targetLayer.addChild(clonedItem);

                // 调整在目标图层中的位置
                if (placeAbove) {
                    clonedItem.insertAbove(targetItem.paperItem); // 修正：placeAbove应该使用insertAbove
                } else {
                    clonedItem.insertBelow(targetItem.paperItem); // 修正：placeBelow应该使用insertBelow
                }
                
                // 同步实例数据
                syncInstancesAfterMove(originalPaperItem, clonedItem, targetLayerId);
            }
        } else {
            // 同一图层内重排序
            if (placeAbove) {
                sourceItem.paperItem.insertAbove(targetItem.paperItem); // 修正：placeAbove应该使用insertAbove
            } else {
                sourceItem.paperItem.insertBelow(targetItem.paperItem); // 修正：placeBelow应该使用insertBelow
            }
        }

        // 更新图层项数据
        updateAllLayerItems();
    };

    // 同步实例数据：在Paper.js图元移动后更新对应的ImageInstance/Model3DInstance
    const syncInstancesAfterMove = (oldPaperItem: paper.Item, newPaperItem: paper.Item, newLayerId: string) => {
        const itemData = oldPaperItem.data;

        if (!itemData) {
            return;
        }

        // 处理图片实例同步
        if (itemData.type === 'image' && itemData.imageId) {
            const imageInstances = (window as any).tanvaImageInstances || [];

            const imageInstance = imageInstances.find((img: any) => img.id === itemData.imageId);
            if (imageInstance) {
                imageInstance.layerId = newLayerId;
                imageInstance.layerIndex = parseInt(newLayerId) || 0;

                // 触发实例更新事件
                window.dispatchEvent(new CustomEvent('imageInstanceUpdated', {
                    detail: { imageId: itemData.imageId, layerId: newLayerId }
                }));
            }
        }

        // 处理3D模型实例同步
        if (itemData.type === '3d-model' && itemData.modelId) {
            const model3DInstances = (window as any).tanvaModel3DInstances || [];

            const modelInstance = model3DInstances.find((model: any) => model.id === itemData.modelId);
            if (modelInstance) {
                modelInstance.layerId = newLayerId;
                modelInstance.layerIndex = parseInt(newLayerId) || 0;

                // 触发实例更新事件
                window.dispatchEvent(new CustomEvent('model3DInstanceUpdated', {
                    detail: { modelId: itemData.modelId, layerId: newLayerId }
                }));
            }
        }
    };

    // 图元移动到指定图层
    const handleItemMoveToLayer = (sourceItemId: string, targetLayerId: string) => {
        const sourceItem = Object.values(layerItems).flat().find(item => item.id === sourceItemId);

        if (!sourceItem?.paperItem) {
            console.warn('无法找到对应的Paper.js对象');
            return;
        }

        const targetLayer = paper.project.layers.find(l => l.name === `layer_${targetLayerId}`);
        if (!targetLayer) {
            console.warn('无法找到目标图层');
            return;
        }

        // 保存原始Paper.js项的引用和数据
        const originalPaperItem = sourceItem.paperItem;
        
        // 克隆图元并移动到目标图层的最顶层
        const clonedItem = sourceItem.paperItem.clone({
            deep: true, // 深度克隆，确保所有数据都被复制
            insert: false // 不自动插入，手动控制位置
        });
        
        // 确保数据完整复制
        if (originalPaperItem.data) {
            clonedItem.data = { ...originalPaperItem.data };
        }
        
        // 移除原始项并添加克隆项到目标图层
        sourceItem.paperItem.remove();
        targetLayer.addChild(clonedItem);

        // 同步实例数据
        syncInstancesAfterMove(originalPaperItem, clonedItem, targetLayerId);

        // 更新图层项数据
        updateAllLayerItems();
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
            case 'path':
                return <Pen className="w-3 h-3" />;
            default:
                return <Pen className="w-3 h-3" />; // 默认使用笔图标表示路径
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

    // 专注模式或面板关闭时隐藏
    if (focusMode || !showLayerPanel) return null;

    return (
        <>
        <div
            className={`fixed top-0 left-0 h-full w-80 bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border-r border-liquid-glass z-[1000] transform transition-transform duration-[50ms] ease-out ${showLayerPanel ? 'translate-x-0' : '-translate-x-full'
                }`}
        >
            {/* 面板头部 */}
            <div className="flex items-center justify-between px-4 pt-6 pb-4">
                <h2 className="text-lg font-semibold text-gray-800">图层</h2>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-gray-600 hover:text-gray-800 bg-transparent"
                    onClick={handleClose}
                    title="收起图层面板"
                    aria-label="收起图层面板"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            </div>

            {/* 分隔线 */}
            <div className="mx-4 h-px bg-gray-200" />

            {/* 图层列表 */}
            <div className="flex-1 overflow-y-auto pb-12">
                <div
                    ref={containerRef}
                    className="relative p-3 space-y-2"
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';

                        // 计算是否在列表的边界区域
                        const rect = containerRef.current?.getBoundingClientRect();
                        if (!rect) return;

                        const y = e.clientY;
                        const topBoundary = rect.top + 8; // 减小边界检测区域，避免与图层元素冲突
                        const bottomBoundary = rect.bottom - 8;

                        // 检查是否有图层
                        if (layers.length === 0) return;

                        if (y < topBoundary) {
                            // 拖拽到列表顶部 - 放在第一个图层之前
                            setDragOverPosition('above');
                            // 使用与图层元素相同的计算逻辑
                            const containerPadding = 12; // p-3 = 12px
                            if (layers.length > 0) {
                                // 如果有图层，计算到第一个图层的中间位置
                                const layerElements = Array.from(containerRef.current?.children || []).filter(child =>
                                    !child.className.includes('absolute')
                                ) as HTMLElement[];
                                const firstLayerElement = layerElements[0];
                                if (firstLayerElement) {
                                    const firstRect = firstLayerElement.getBoundingClientRect();
                                    const cRect = containerRef.current.getBoundingClientRect();
                                    const edge = cRect.top + containerPadding + (firstRect.top - cRect.top - containerPadding) / 2 - 10;
                                    setIndicatorY(edge - cRect.top + containerRef.current.scrollTop);
                                } else {
                                    setIndicatorY(containerPadding / 2 - 10);
                                }
                            } else {
                                setIndicatorY(containerPadding / 2 - 10);
                            }
                            logger.debug('边界拖拽：移动到顶部');
                        } else if (y > bottomBoundary) {
                            // 拖拽到列表底部 - 放在最后一个图层之后
                            setDragOverPosition('below');
                            // 使用与图层元素相同的计算逻辑
                            const layerElements = Array.from(containerRef.current?.children || []).filter(child =>
                                !child.className.includes('absolute') // 过滤掉指示线元素
                            ) as HTMLElement[];
                            const lastLayerElement = layerElements[layerElements.length - 1];
                            if (lastLayerElement) {
                                const lastRect = lastLayerElement.getBoundingClientRect();
                                const cRect = containerRef.current.getBoundingClientRect();
                                const containerPadding = 12; // p-3 = 12px
                                const edge = lastRect.bottom + (cRect.bottom - lastRect.bottom - containerPadding) / 2 - 10;
                                setIndicatorY(edge - cRect.top + containerRef.current.scrollTop);
                                logger.debug('边界拖拽：移动到底部');
                            }
                        }
                    }}
                    onDragLeave={(e) => {
                        // 只有当鼠标完全离开容器时才清除指示器
                        const rect = containerRef.current?.getBoundingClientRect();
                        if (!rect) return;

                        if (e.clientX < rect.left || e.clientX > rect.right ||
                            e.clientY < rect.top || e.clientY > rect.bottom) {
                            setIndicatorY(null);
                            setItemIndicatorY(null);
                        }
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        const layerId = e.dataTransfer.getData('text/layer-id');
                        const itemId = e.dataTransfer.getData('text/item-id');

                        if (layerId && layers.length > 0) {
                            // 计算拖拽位置
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (!rect) return;

                            const y = e.clientY;
                            const topBoundary = rect.top + 8;
                            const bottomBoundary = rect.bottom - 8;

                            if (y < topBoundary) {
                                // 移动到第一个图层之前
                                reorderLayer(layerId, layers[0].id, true);
                                logger.debug('执行边界拖拽：移动到顶部');
                            } else if (y > bottomBoundary) {
                                // 移动到最后一个图层之后
                                reorderLayer(layerId, layers[layers.length - 1].id, false);
                                logger.debug('执行边界拖拽：移动到底部');
                            }
                        }

                        setIndicatorY(null);
                        setItemIndicatorY(null);
                        setDraggedLayerId(null);
                        setDraggedItemId(null);
                    }}
                >
                    {layers.map(layer => {
                        const isExpanded = expandedLayers.has(layer.id);
                        const items = layerItems[layer.id] || [];

                        return (
                            <div key={layer.id}>
                                {/* 图层项 */}
                                <div
                                    className={`flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 group ${activeLayerId === layer.id ? 'bg-gray-800/10 border border-gray-800/20' : ''}`}
                                    onClick={() => activateLayer(layer.id)}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/layer-id', layer.id);
                                        e.dataTransfer.effectAllowed = 'move';
                                        setDragOverPosition('above');
                                        setDraggedLayerId(layer.id); // 保存拖拽源
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation(); // 防止冒泡到容器级别的边界检测
                                        e.dataTransfer.dropEffect = 'move';
                                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                        const middle = rect.top + rect.height / 2;
                                        const pos: 'above' | 'below' = e.clientY < middle ? 'above' : 'below';
                                        setDragOverPosition(pos);

                                        // 如果有拖拽源信息，预测实际插入位置
                                        if (containerRef.current && draggedLayerId) {
                                            const cRect = containerRef.current.getBoundingClientRect();
                                            const actualInsertIndex = predictInsertPosition(draggedLayerId, layer.id, pos === 'above');

                                            if (actualInsertIndex >= 0 && actualInsertIndex <= layers.length) {
                                                // 根据实际插入位置计算指示线位置
                                                let edge: number;
                                                // 获取所有图层元素（排除指示线元素）
                                                const layerElements = Array.from(containerRef.current.children).filter(child =>
                                                    !child.className.includes('absolute')
                                                ) as HTMLElement[];

                                                if (actualInsertIndex === 0) {
                                                    // 插入到第一个位置，指示线在容器顶部padding区域的中心
                                                    const firstLayerElement = layerElements[0];
                                                    if (firstLayerElement) {
                                                        const firstRect = firstLayerElement.getBoundingClientRect();
                                                        const containerPadding = 12; // p-3 = 12px
                                                        // 计算容器顶部到第一个元素之间空白区域的中心，向上偏移10px
                                                        edge = cRect.top + containerPadding + (firstRect.top - cRect.top - containerPadding) / 2 - 10;
                                                    } else {
                                                        edge = cRect.top + 6 - 10; // padding中心，向上偏移10px
                                                    }
                                                } else if (actualInsertIndex === layers.length) {
                                                    // 插入到最后位置，指示线在最后一个元素到容器底部的中心
                                                    const lastLayerElement = layerElements[layerElements.length - 1];
                                                    if (lastLayerElement) {
                                                        const lastRect = lastLayerElement.getBoundingClientRect();
                                                        const containerPadding = 12; // p-3 = 12px
                                                        // 计算最后一个元素到容器底部空白区域的中心，向上偏移10px
                                                        edge = lastRect.bottom + (cRect.bottom - lastRect.bottom - containerPadding) / 2 - 10;
                                                    } else {
                                                        edge = cRect.bottom - 6 - 10; // padding中心，向上偏移10px
                                                    }
                                                } else {
                                                    // 插入到中间位置：计算两个图层框之间空白区域的正中间
                                                    const prevLayerElement = layerElements[actualInsertIndex - 1];
                                                    const nextLayerElement = layerElements[actualInsertIndex];
                                                    if (prevLayerElement && nextLayerElement) {
                                                        const prevRect = prevLayerElement.getBoundingClientRect();
                                                        const nextRect = nextLayerElement.getBoundingClientRect();
                                                        // 计算两个图层框之间空白区域的正中间，向上偏移10px
                                                        edge = prevRect.bottom + (nextRect.top - prevRect.bottom) / 2 - 10;
                                                    } else if (prevLayerElement) {
                                                        const targetRect = prevLayerElement.getBoundingClientRect();
                                                        edge = targetRect.bottom + 4;
                                                    } else {
                                                        edge = rect.bottom + 4;
                                                    }
                                                }
                                                const y = edge - cRect.top + containerRef.current.scrollTop;
                                                setIndicatorY(y);
                                            }
                                        }
                                    }}
                                    onDragLeave={() => {
                                        setIndicatorY(null);
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        const layerId = e.dataTransfer.getData('text/layer-id');
                                        const itemId = e.dataTransfer.getData('text/item-id');

                                        if (layerId) {
                                            // 图层拖拽
                                            reorderLayer(layerId, layer.id, dragOverPosition === 'above');
                                        } else if (itemId) {
                                            // 图元拖拽到图层（移动到目标图层的最顶层）
                                            handleItemMoveToLayer(itemId, layer.id);
                                        }
                                        setIndicatorY(null);
                                        setDraggedLayerId(null); // 清理拖拽源
                                        setDraggedItemId(null); // 清理图元拖拽状态
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
                                    <div
                                        className="ml-6 mt-1 space-y-1"
                                        onDragOver={(e) => {
                                            // 只处理图元拖拽 - 使用状态而不是 getData（onDragOver 中无法获取）
                                            if (!draggedItemId) return;

                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.dataTransfer.dropEffect = 'move';

                                            // 计算是否在图元列表的边界区域
                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            const y = e.clientY;
                                            const topBoundary = rect.top + 4; // 一些余量
                                            const bottomBoundary = rect.bottom - 4;

                                            if (containerRef.current) {
                                                const cRect = containerRef.current.getBoundingClientRect();

                                                if (y < topBoundary) {
                                                    // 拖拽到图元列表顶部 - 放在第一个图元之前
                                                    setDragOverPosition('above');
                                                    const edgeY = rect.top - 2 - cRect.top + containerRef.current.scrollTop;
                                                    setItemIndicatorY(edgeY);
                                                } else if (y > bottomBoundary) {
                                                    // 拖拽到图元列表底部 - 放在最后一个图元之后
                                                    setDragOverPosition('below');
                                                    const edgeY = rect.bottom + 2 - cRect.top + containerRef.current.scrollTop;
                                                    setItemIndicatorY(edgeY);
                                                }
                                            }
                                        }}
                                        onDrop={(e) => {
                                            const sourceId = e.dataTransfer.getData('text/item-id');
                                            if (!sourceId || items.length === 0) return;

                                            e.preventDefault();
                                            e.stopPropagation();

                                            // 计算拖拽位置
                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            const y = e.clientY;
                                            const topBoundary = rect.top + 4;
                                            const bottomBoundary = rect.bottom - 4;

                                            if (y < topBoundary) {
                                                // 移动到第一个图元之前
                                                handleItemReorder(sourceId, items[0].id, true);
                                            } else if (y > bottomBoundary) {
                                                // 移动到最后一个图元之后
                                                handleItemReorder(sourceId, items[items.length - 1].id, false);
                                            }

                                            setItemIndicatorY(null);
                                            setDraggedItemId(null); // 清理拖拽状态
                                        }}
                                    >
                                        {items.map(item => (
                                            <div
                                                key={item.id}
                                                className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 group cursor-pointer ${selectedItemId === item.id ? 'bg-gray-800/10' : ''
                                                    }`}
                                                onClick={() => handleItemClick(item, layer.id)}
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    startEditing(item.id, item.name);
                                                }}
                                                onContextMenu={(e) => handleItemContextMenu(item, e)}
                                                draggable
                                                onDragStart={(e) => {
                                                    e.dataTransfer.setData('text/item-id', item.id);
                                                    e.dataTransfer.effectAllowed = 'move';
                                                    setDragOverPosition('above');
                                                    setDraggedItemId(item.id); // 保存拖拽的图元ID
                                                }}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    e.dataTransfer.dropEffect = 'move';
                                                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                                    const middle = rect.top + rect.height / 2;
                                                    const pos: 'above' | 'below' = e.clientY < middle ? 'above' : 'below';
                                                    setDragOverPosition(pos);
                                                    setDragOverItemId(item.id);

                                                    if (containerRef.current && draggedItemId) {
                                                        const cRect = containerRef.current.getBoundingClientRect();
                                                        // 使用预测函数确定实际插入位置
                                                        const actualInsertIndex = predictItemInsertPosition(draggedItemId, item.id, pos === 'above');

                                                        if (actualInsertIndex >= 0 && actualInsertIndex <= items.length) {
                                                            // 根据预测的实际插入位置计算指示线位置
                                                            // 指示线应该显示在两个图元之间的中间位置
                                                            const itemElements = Array.from(e.currentTarget.parentElement?.children || []).filter(child =>
                                                                child.tagName === 'DIV' && !child.className.includes('absolute')
                                                            ) as HTMLElement[];

                                                            let edge: number;
                                                            if (actualInsertIndex === 0) {
                                                                // 插入到第一个位置：指示线在图元容器顶部到第一个元素之间的中心
                                                                const firstElement = itemElements[0];
                                                                if (firstElement) {
                                                                    const firstRect = firstElement.getBoundingClientRect();
                                                                    const itemContainerRect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                                                                    const marginTop = 4; // mt-1 = 4px
                                                                    // 计算图元容器顶部到第一个图元之间空白区域的中心，向上偏移10px
                                                                    edge = itemContainerRect.top + marginTop + (firstRect.top - itemContainerRect.top - marginTop) / 2 - 10;
                                                                } else {
                                                                    edge = rect.top - 10;
                                                                }
                                                            } else if (actualInsertIndex === items.length) {
                                                                // 插入到最后一个位置：指示线在最后一个元素到容器底部的中心
                                                                const lastElement = itemElements[itemElements.length - 1];
                                                                if (lastElement) {
                                                                    const lastRect = lastElement.getBoundingClientRect();
                                                                    const itemContainerRect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                                                                    // 图元容器没有底部padding，所以直接计算到容器底部，向上偏移10px
                                                                    edge = lastRect.bottom + (itemContainerRect.bottom - lastRect.bottom) / 2 - 10;
                                                                } else {
                                                                    edge = rect.bottom - 10;
                                                                }
                                                            } else {
                                                                // 插入到中间位置：计算两个图元框之间空白区域的正中间
                                                                const prevElement = itemElements[actualInsertIndex - 1];
                                                                const nextElement = itemElements[actualInsertIndex];
                                                                if (prevElement && nextElement) {
                                                                    const prevRect = prevElement.getBoundingClientRect();
                                                                    const nextRect = nextElement.getBoundingClientRect();
                                                                    // 计算两个图元框之间空白区域的正中间，向上偏移10px
                                                                    edge = prevRect.bottom + (nextRect.top - prevRect.bottom) / 2 - 10;
                                                                } else if (prevElement) {
                                                                    const targetRect = prevElement.getBoundingClientRect();
                                                                    edge = targetRect.bottom + 2;
                                                                } else {
                                                                    edge = pos === 'above' ? rect.top - 2 : rect.bottom + 2;
                                                                }
                                                            }
                                                            const y = edge - cRect.top + containerRef.current.scrollTop;
                                                            setItemIndicatorY(y);
                                                        }
                                                    }
                                                }}
                                                onDragLeave={() => {
                                                    setItemIndicatorY(null);
                                                    setDragOverItemId(null);
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    const sourceId = e.dataTransfer.getData('text/item-id');
                                                    if (sourceId && sourceId !== item.id) {
                                                        handleItemReorder(sourceId, item.id, dragOverPosition === 'above');
                                                    }
                                                    setItemIndicatorY(null);
                                                    setDragOverItemId(null);
                                                    setDraggedItemId(null); // 清理拖拽状态
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

                    {/* 新建图层按钮 */}
                    <div
                        className="flex items-center justify-center p-2 rounded-lg border border-dashed border-gray-300 hover:bg-gray-50 hover:border-gray-400 cursor-pointer transition-colors"
                        onClick={() => createLayer(undefined, true)}
                        title="新建图层"
                    >
                        <Plus className="h-5 w-5 text-gray-400" />
                    </div>

                    {indicatorY !== null && (
                        <div className={indicatorClass} style={{ top: indicatorY }} />
                    )}
                    {itemIndicatorY !== null && (
                        <div className={indicatorClass} style={{ top: itemIndicatorY }} />
                    )}
                </div>
            </div>

            {/* 面板底部 - 固定在最底部 */}
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-white">
                <div className="text-xs text-gray-500 text-center">
                    共 {layers.length} 个图层，
                    {Object.values(layerItems).flat().length} 个图元
                </div>
            </div>
        </div>

        {/* 上下文菜单 */}
        {contextMenu.visible && contextMenu.item && (
            <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                onClose={() => setContextMenu({ visible: false, x: 0, y: 0, item: null })}
                items={[
                    ...(contextMenu.item.type === 'image' ? [
                        {
                            label: 'AI编辑图像',
                            icon: <Sparkles className="w-4 h-4" />,
                            onClick: () => { void handleAIEditImage(contextMenu.item!).catch(() => {}); },
                        }
                    ] : []),
                    {
                        label: contextMenu.item.visible ? '隐藏' : '显示',
                        icon: contextMenu.item.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />,
                        onClick: () => {
                            if (contextMenu.item) {
                                handleItemVisibilityToggle(contextMenu.item, {} as React.MouseEvent);
                            }
                        },
                    },
                    {
                        label: contextMenu.item.locked ? '解锁' : '锁定',
                        icon: contextMenu.item.locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />,
                        onClick: () => {
                            if (contextMenu.item) {
                                handleItemLockToggle(contextMenu.item, {} as React.MouseEvent);
                            }
                        },
                    },
                    {
                        label: '删除',
                        icon: <Trash2 className="w-4 h-4 text-red-500" />,
                        onClick: () => {
                            if (contextMenu.item) {
                                handleItemDelete(contextMenu.item, {} as React.MouseEvent);
                            }
                        },
                    },
                ]}
            />
        )}
        </>
    );
};

export default LayerPanel;
