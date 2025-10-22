/**
 * 快速图片上传Hook
 * 直接选择图片并自动放置到画布中心
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import { historyService } from '@/services/historyService';
import { useUIStore } from '@/stores/uiStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { imageUploadService } from '@/services/imageUploadService';
import type { DrawingContext, StoredImageAsset } from '@/types/canvas';

interface UseQuickImageUploadProps {
    context: DrawingContext;
    canvasRef?: React.RefObject<HTMLCanvasElement | null>;
    projectId?: string | null;
}

const isInlineDataUrl = (value?: string | null): value is string => {
    if (typeof value !== 'string') return false;
    return value.startsWith('data:image') || value.startsWith('blob:');
};

export const useQuickImageUpload = ({ context, canvasRef, projectId }: UseQuickImageUploadProps) => {
    const { ensureDrawingLayer, zoom } = context;
    const [triggerQuickUpload, setTriggerQuickUpload] = useState(false);

    // ========== 智能排版工具函数 ==========
    
    // 获取画布上所有图像的位置信息
    const getAllCanvasImages = useCallback(() => {
        const images: Array<{
            id: string;
            x: number;
            y: number;
            width: number;
            height: number;
            operationType?: string;
        }> = [];

        try {
            if (!paper.project) return images;

            // 遍历所有图层查找图像
            for (const layer of paper.project.layers) {
                for (const item of layer.children) {
                    // 查找图像组或直接的图像项
                    if (item.data?.type === 'image' || 
                        (item instanceof paper.Group && item.data?.type === 'image')) {
                        
                        let raster: paper.Raster | null = null;
                        let bounds: paper.Rectangle | null = null;

                        if (item instanceof paper.Group) {
                            // 从组中找到Raster对象
                            raster = item.children.find(child => child instanceof paper.Raster) as paper.Raster;
                            bounds = raster?.bounds || item.bounds;
                        } else if (item instanceof paper.Raster) {
                            raster = item;
                            bounds = item.bounds;
                        }

                        if (bounds && item.data?.imageId) {
                            images.push({
                                id: item.data.imageId,
                                x: bounds.center.x,
                                y: bounds.center.y,
                                width: bounds.width,
                                height: bounds.height,
                                operationType: item.data.operationType
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('获取画布图像时出错:', error);
        }

        console.log('📊 画布图像统计:', images.length, '张图像:', images);
        return images;
    }, []);

    // 根据ID查找特定图像
    const findImageById = useCallback((imageId: string) => {
        const images = getAllCanvasImages();
        return images.find(img => img.id === imageId);
    }, [getAllCanvasImages]);

    // 计算智能排版位置
    const calculateSmartPosition = useCallback((
        operationType: string, 
        sourceImageId?: string,
        sourceImages?: string[]
    ) => {
        const getSpacing = () => useUIStore.getState().smartPlacementOffset || 778;
        const existingImages = getAllCanvasImages();

        console.log('🧠 智能排版计算:', {
            operationType,
            sourceImageId,
            sourceImages,
            existingImageCount: existingImages.length
        });

        switch (operationType) {
            case 'generate': {
                // 生成图：默认向下排列（若未提供smartPosition）
                const spacing = getSpacing();
                const genImages = existingImages.filter(img => 
                    img.operationType === 'generate' || !img.operationType
                );
                const gpos = { x: 0, y: genImages.length * spacing };
                console.log('📍 生成图默认位置计算(向下):', gpos, '(基于', genImages.length, '张现有图像)');
                return gpos;
            }

            case 'edit': {
                // 编辑图：基于原图向右偏移
                const spacing = getSpacing();
                if (sourceImageId) {
                    const sourceImage = findImageById(sourceImageId);
                    if (sourceImage) {
                        const position = { x: sourceImage.x + spacing, y: sourceImage.y };
                        console.log('📍 编辑图位置计算(向右):', position, '(基于源图', sourceImageId, ')');
                        return position;
                    }
                }
                // 没有找到源图，默认向右偏移
                const editPosition = { x: spacing, y: 0 };
                console.log('📍 编辑图默认位置(向右):', editPosition);
                return editPosition;
            }

            case 'blend': {
                // 融合图：基于第一张源图向右偏移
                const spacing = getSpacing();
                if (sourceImages && sourceImages.length > 0) {
                    const firstSourceImage = findImageById(sourceImages[0]);
                    if (firstSourceImage) {
                        const position = { x: firstSourceImage.x + spacing, y: firstSourceImage.y };
                        console.log('📍 融合图位置计算(向右):', position, '(基于第一张源图', sourceImages[0], ')');
                        return position;
                    }
                }
                // 没有找到源图，默认向右偏移
                const blendPosition = { x: spacing, y: 0 };
                console.log('📍 融合图默认位置(向右):', blendPosition);
                return blendPosition;
            }

            default:
                // 默认位置
                const defaultPosition = { x: 0, y: 0 };
                console.log('📍 默认位置:', defaultPosition);
                return defaultPosition;
        }
    }, [getAllCanvasImages, findImageById]);

    // ========== 查找画布中的图片占位框 ==========
    const findImagePlaceholder = useCallback(() => {
        try {
            if (!paper.project) return null;

            // 遍历所有图层查找占位框
            for (const layer of paper.project.layers) {
                for (const item of layer.children) {
                    if (item.data?.type === 'image-placeholder' && item.data?.bounds) {
                        return item;
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('查找占位框时出错:', error);
            return null;
        }
    }, []);

    // 处理快速图片上传 - 支持智能位置排版
    const handleQuickImageUploaded = useCallback(async (
        imagePayload: string | StoredImageAsset,
        fileName?: string,
        selectedImageBounds?: any,
        smartPosition?: { x: number; y: number },
        operationType?: string,
        sourceImageId?: string,
        sourceImages?: string[]
    ) => {
        let asset: StoredImageAsset | null = null;
        if (typeof imagePayload === 'string') {
            const uploadDir = projectId ? `projects/${projectId}/images/` : 'uploads/images/';
            const uploadResult = await imageUploadService.uploadImageDataUrl(imagePayload, {
                projectId,
                dir: uploadDir,
                fileName,
            });
            if (uploadResult.success && uploadResult.asset) {
                asset = { ...uploadResult.asset, src: uploadResult.asset.url, localDataUrl: imagePayload };
                fileName = asset.fileName || fileName;
            } else {
                const errMsg = uploadResult.error || '图片上传失败';
                logger.error('快速上传图片失败:', errMsg);
                asset = {
                    id: `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    url: imagePayload,
                    src: imagePayload,
                    fileName: fileName,
                    pendingUpload: true,
                    localDataUrl: imagePayload,
                };
            }
        } else {
            asset = {
                ...imagePayload,
                src: imagePayload.url || imagePayload.src,
                localDataUrl: isInlineDataUrl(imagePayload.localDataUrl)
                    ? imagePayload.localDataUrl
                    : isInlineDataUrl(imagePayload.src)
                        ? imagePayload.src
                        : undefined
            };
            fileName = asset.fileName || fileName;
        }

        if (!asset || !asset.url) {
            logger.error('快速上传未获取到有效图片资源');
            return;
        }

        const imageData = asset.url;
        try {
            ensureDrawingLayer();

            // 智能位置计算：优先使用传入的智能位置，否则计算智能位置
            let targetPosition: paper.Point;
            
            if (smartPosition) {
                // 使用传入的智能位置
                targetPosition = new paper.Point(smartPosition.x, smartPosition.y);
                logger.upload(`📍 快速上传：使用智能位置 (${smartPosition.x}, ${smartPosition.y})`);
            } else if (operationType) {
                // 计算智能位置
                const calculated = calculateSmartPosition(operationType, sourceImageId, sourceImages);
                targetPosition = new paper.Point(calculated.x, calculated.y);
                logger.upload(`📍 快速上传：计算智能位置 (${calculated.x}, ${calculated.y}) 操作类型: ${operationType}`);
            } else {
                // 默认使用当前视口中心（世界坐标），避免因平移导致"看起来不在中间"
                const center = paper.view && (paper.view as any).center
                  ? (paper.view as any).center
                  : new paper.Point(0, 0);
                targetPosition = new paper.Point(center.x, center.y);
                logger.upload(`📍 快速上传：默认使用视口中心 (${targetPosition.x.toFixed(1)}, ${targetPosition.y.toFixed(1)})`);
            }

            // 生成唯一ID
            const imageId = asset.id || `quick_image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // 创建图片的 Raster 对象（先绑定 onLoad 再设置 source，避免极快缓存触发导致丢失回调）
            const raster = new paper.Raster();
            (raster as any).crossOrigin = 'anonymous';
            raster.position = targetPosition;
            
            // 提前记录，便于排查定位
            try { console.log('[QuickUpload] 准备加载图片', { targetPosition }); } catch {}

            // 等待图片加载完成
            raster.onLoad = () => {
                if (!asset) {
                    logger.error('快速上传：缺少图片资源');
                    return;
                }
                try { console.log('[QuickUpload] 图片加载完成', { w: raster.width, h: raster.height }); } catch {}
                // 获取原始尺寸
                const originalWidth = raster.width;
                const originalHeight = raster.height;

                // 检查是否启用原始尺寸模式
                const useOriginalSize = localStorage.getItem('tanva-use-original-size') === 'true';

                let displayWidth = originalWidth;
                let displayHeight = originalHeight;
                let finalPosition = targetPosition;
                let placeholder = null;

                // 🎯 优先使用传递的选中图片边界，其次查找占位框
                let targetBounds = selectedImageBounds;
                if (!targetBounds) {
                    placeholder = findImagePlaceholder();
                    if (placeholder && placeholder.data?.bounds) {
                        targetBounds = placeholder.data.bounds;
                    }
                }

                if (targetBounds) {
                    const sourceType = selectedImageBounds ? '选中图片边界' : '占位框';
                    logger.upload(`🎯 发现${sourceType}，使用边界尺寸进行自适应`);

                    // 计算目标边界的中心点和尺寸
                    const targetCenter = new paper.Point(
                        targetBounds.x + targetBounds.width / 2,
                        targetBounds.y + targetBounds.height / 2
                    );

                    const boxAspectRatio = targetBounds.width / targetBounds.height;
                    const imageAspectRatio = originalWidth / originalHeight;

                    if (useOriginalSize) {
                        // 原始尺寸模式：以目标边界中心为基准，使用图片原始尺寸
                        finalPosition = targetCenter;
                        displayWidth = originalWidth;
                        displayHeight = originalHeight;
                    } else {
                        // 自适应模式：根据目标边界和图片比例计算保持比例的实际大小
                        if (imageAspectRatio > boxAspectRatio) {
                            // 图片更宽，以目标边界宽度为准
                            displayWidth = targetBounds.width;
                            displayHeight = displayWidth / imageAspectRatio;
                        } else {
                            // 图片更高，以目标边界高度为准
                            displayHeight = targetBounds.height;
                            displayWidth = displayHeight * imageAspectRatio;
                        }
                        finalPosition = targetCenter;
                    }

                    // 删除占位框（如果存在）
                    if (placeholder) {
                        placeholder.remove();
                        logger.upload('🗑️ 已删除占位框');
                    }
                } else {
                    // 没有占位框，使用原有的逻辑
                    if (!useOriginalSize) {
                    // 标准模式：限制最大显示尺寸，但保持原始长宽比
                    const maxSize = 768;
                    if (originalWidth > maxSize || originalHeight > maxSize) {
                        // 保持原始长宽比，按最大边缩放
                        if (originalWidth > originalHeight) {
                            // 宽图：以宽度为准
                            displayWidth = maxSize;
                            displayHeight = maxSize * (originalHeight / originalWidth);
                        } else {
                            // 高图：以高度为准
                            displayHeight = maxSize;
                            displayWidth = maxSize * (originalWidth / originalHeight);
                        }
                    }
                    }
                    // 原始尺寸模式：直接使用原图分辨率，1像素=1像素显示
                }

                // 🎯 关键修复：不设置raster.size，保持原始分辨率
                // raster.size = new paper.Size(displayWidth, displayHeight); // ❌ 移除这行
                
                // 通过bounds控制显示区域，保持原始分辨率
                raster.bounds = new paper.Rectangle(
                    finalPosition.x - displayWidth / 2,
                    finalPosition.y - displayHeight / 2,
                    displayWidth,
                    displayHeight
                );
                raster.position = finalPosition;

                // 存储元数据
                raster.data = {
                    type: 'image',
                    imageId: imageId,
                    originalWidth: originalWidth,
                    originalHeight: originalHeight,
                    fileName: fileName || 'quick-uploaded-image',
                    uploadMethod: 'smart-layout',
                    aspectRatio: originalWidth / originalHeight,
                    operationType: operationType || 'manual',
                    sourceImageId: sourceImageId,
                    sourceImages: sourceImages
                };

                // 创建选择框（默认隐藏，点击时显示）
                const selectionBorder = new paper.Path.Rectangle({
                    rectangle: raster.bounds,
                    strokeColor: new paper.Color('#3b82f6'),
                    strokeWidth: 1,
                    fillColor: null,
                    selected: false,
                    visible: false  // 默认隐藏
                });
                selectionBorder.data = {
                    isSelectionBorder: true,
                    isHelper: true
                };

                // 添加四个角的调整控制点（默认隐藏）
                const handleSize = 12;
                const handleColor = new paper.Color('#3b82f6');
                const bounds = raster.bounds;

                const handles = [
                    { direction: 'nw', position: [bounds.left, bounds.top] },
                    { direction: 'ne', position: [bounds.right, bounds.top] },
                    { direction: 'sw', position: [bounds.left, bounds.bottom] },
                    { direction: 'se', position: [bounds.right, bounds.bottom] }
                ];

                const handleElements: paper.Path[] = [];
                handles.forEach(({ direction, position }) => {
                    const handle = new paper.Path.Rectangle({
                        point: [position[0] - handleSize / 2, position[1] - handleSize / 2],
                        size: [handleSize, handleSize],
                        fillColor: 'white',  // 改为白色填充（空心效果）
                        strokeColor: handleColor,  // 蓝色边框
                        strokeWidth: 1,  // 增加边框宽度让空心效果更明显
                        selected: false,
                        visible: false  // 默认隐藏
                    });
                    handle.data = {
                        isResizeHandle: true,
                        direction,
                        imageId,
                        isHelper: true
                    };
                    handleElements.push(handle);
                });

                // 创建组合：仅包含 Raster 与可视辅助，避免隐形交互矩形扩大边界
                const imageGroup = new paper.Group([raster, selectionBorder, ...handleElements]);
                imageGroup.data = {
                    type: 'image',
                    imageId: imageId,
                    isHelper: false,
                    operationType: operationType || 'manual',
                    sourceImageId: sourceImageId,
                    sourceImages: sourceImages
                };

                // 添加到全局图片实例管理（如果有的话）
                if ((window as any).tanvaImageInstances) {
                const newImageInstance = {
                    id: imageId,
                    imageData: {
                        id: imageId,
                        url: asset.url,
                        src: asset.url,
                        localDataUrl: asset.localDataUrl,
                        key: asset.key,
                        fileName: fileName,
                        width: raster.bounds.width,
                        height: raster.bounds.height,
                        contentType: asset.contentType,
                        },
                        bounds: {
                            x: raster.bounds.x,
                            y: raster.bounds.y,
                            width: raster.bounds.width,
                            height: raster.bounds.height
                        },
                        isSelected: false,
                        visible: true,
                        layerId: paper.project.activeLayer.name
                    };

                    // 触发图片实例更新事件
                    window.dispatchEvent(new CustomEvent('quickImageAdded', {
                        detail: newImageInstance
                    }));
                }

                // 记录历史，优先使用 OSS 链接，便于刷新后从云端恢复
                try {
                    const addHistory = useImageHistoryStore.getState().addImage;
                    addHistory({
                        id: imageId,
                        src: asset.url,
                        remoteUrl: asset.url,
                        thumbnail: asset.localDataUrl || asset.url,
                        title: fileName ? `快速上传 · ${fileName}` : '快速上传图片',
                        nodeId: 'canvas',
                        nodeType: 'image'
                    });
                } catch (historyError) {
                    try { console.warn('[QuickUpload] 写入图片历史失败:', historyError); } catch {}
                }

                const positionInfo = selectedImageBounds ? '选中图片位置' : (placeholder ? '占位框位置' : '坐标原点');
                logger.upload(`✅ 快速上传成功：图片已添加到${positionInfo} - ${fileName || 'uploaded-image'}`);
                try { historyService.commit('add-image').catch(() => {}); } catch {}

                // 若图片落点不在当前视口内，自动将视口平移到图片中心，避免“已成功但看不见”的困扰
                try {
                    const vb = paper.view.bounds;
                    const inView = vb && vb.intersects(raster.bounds);
                    if (!inView) {
                        const { zoom: z, setPan } = useCanvasStore.getState();
                        const vs = paper.view.viewSize;
                        const cx = vs.width / 2; // 屏幕中心（项目坐标）
                        const cy = vs.height / 2;
                        const desiredPanX = (cx / z) - raster.position.x;
                        const desiredPanY = (cy / z) - raster.position.y;
                        setPan(desiredPanX, desiredPanY);
                        try { console.log('[QuickUpload] 自动居中到新图片', { desiredPanX, desiredPanY, z }); } catch {}
                    }
                } catch (e) {
                    try { console.warn('[QuickUpload] 自动居中失败', e); } catch {}
                }
                paper.view.update();
            };

            raster.onError = (e: any) => {
                logger.error('图片加载失败');
                try { console.error('[QuickUpload] 图片加载失败', e); } catch {}
            };

            // 触发加载
            raster.source = imageData;
        } catch (error) {
            logger.error('快速上传图片时出错:', error);
            console.error('快速上传图片时出错:', error);
        }
    }, [ensureDrawingLayer, calculateSmartPosition, findImagePlaceholder, projectId]);

    // 处理上传错误
    const handleQuickUploadError = useCallback((error: string) => {
        logger.error('快速上传失败:', error);
    }, []);

    // 处理触发完成
    const handleQuickUploadTriggerHandled = useCallback(() => {
        setTriggerQuickUpload(false);
    }, []);

    // 触发快速上传
    const triggerQuickImageUpload = useCallback(() => {
        setTriggerQuickUpload(true);
    }, []);

    return {
        triggerQuickUpload,
        triggerQuickImageUpload,
        handleQuickImageUploaded,
        handleQuickUploadError,
        handleQuickUploadTriggerHandled,
        // 智能排版相关函数
        calculateSmartPosition,
        getAllCanvasImages,
        findImageById
    };
};
