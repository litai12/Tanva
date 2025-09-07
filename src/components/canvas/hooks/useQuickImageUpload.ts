/**
 * 快速图片上传Hook
 * 直接选择图片并自动放置到画布中心
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import type { DrawingContext } from '@/types/canvas';

interface UseQuickImageUploadProps {
    context: DrawingContext;
    canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export const useQuickImageUpload = ({ context, canvasRef }: UseQuickImageUploadProps) => {
    const { ensureDrawingLayer, zoom } = context;
    const [triggerQuickUpload, setTriggerQuickUpload] = useState(false);

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

    // 处理快速图片上传 - 自动放置到坐标轴交叉点(0,0)
    const handleQuickImageUploaded = useCallback((imageData: string, fileName?: string, selectedImageBounds?: any) => {
        try {
            ensureDrawingLayer();

            // 使用坐标轴交叉点位置 (0, 0)
            const centerPosition = new paper.Point(0, 0);

            logger.upload(`📍 快速上传：将图片放置在坐标原点 (0, 0)`);

            // 生成唯一ID
            const imageId = `quick_image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // 创建图片的Raster对象
            const raster = new paper.Raster({
                source: imageData,
                position: centerPosition
            });

            // 等待图片加载完成
            raster.onLoad = () => {
                // 获取原始尺寸
                const originalWidth = raster.width;
                const originalHeight = raster.height;

                // 检查是否启用原始尺寸模式
                const useOriginalSize = localStorage.getItem('tanva-use-original-size') === 'true';

                let displayWidth = originalWidth;
                let displayHeight = originalHeight;
                let finalPosition = centerPosition;
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
                        // 标准模式：限制最大显示尺寸
                        const maxSize = 1200;
                        if (originalWidth > maxSize || originalHeight > maxSize) {
                            const scale = Math.min(maxSize / originalWidth, maxSize / originalHeight);
                            displayWidth = originalWidth * scale;
                            displayHeight = originalHeight * scale;
                        }
                    }
                    // 原始尺寸模式：直接使用原图分辨率，1像素=1像素显示
                }

                // 设置显示尺寸和位置
                raster.size = new paper.Size(displayWidth, displayHeight);
                raster.position = finalPosition;

                // 存储元数据
                raster.data = {
                    type: 'image',
                    imageId: imageId,
                    originalWidth: originalWidth,
                    originalHeight: originalHeight,
                    fileName: fileName || 'quick-uploaded-image',
                    uploadMethod: 'quick-center',
                    aspectRatio: originalWidth / originalHeight
                };

                // 创建选择框（默认隐藏，点击时显示）
                const selectionBorder = new paper.Path.Rectangle({
                    rectangle: raster.bounds,
                    strokeColor: new paper.Color('#3b82f6'),
                    strokeWidth: 2,
                    fillColor: null,
                    selected: false,
                    visible: false  // 默认隐藏
                });
                selectionBorder.data = {
                    isSelectionBorder: true,
                    isHelper: true
                };

                // 添加四个角的调整控制点（默认隐藏）
                const handleSize = 8;
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
                        strokeWidth: 2,  // 增加边框宽度让空心效果更明显
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

                // 创建透明矩形用于交互
                const imageRect = new paper.Path.Rectangle({
                    rectangle: raster.bounds,
                    fillColor: null,
                    strokeColor: null
                });

                // 创建组合，包含所有元素
                const imageGroup = new paper.Group([imageRect, raster, selectionBorder, ...handleElements]);
                imageGroup.data = {
                    type: 'image',
                    imageId: imageId,
                    isHelper: false
                };

                // 添加到全局图片实例管理（如果有的话）
                if ((window as any).tanvaImageInstances) {
                    const newImageInstance = {
                        id: imageId,
                        imageData: {
                            id: imageId,
                            src: imageData,
                            fileName: fileName
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

                const positionInfo = selectedImageBounds ? '选中图片位置' : (placeholder ? '占位框位置' : '坐标原点');
                logger.upload(`✅ 快速上传成功：图片已添加到${positionInfo} - ${fileName || 'uploaded-image'}`);
                paper.view.update();
            };

            raster.onError = () => {
                logger.error('图片加载失败');
            };
        } catch (error) {
            logger.error('快速上传图片时出错:', error);
            console.error('快速上传图片时出错:', error);
        }
    }, [ensureDrawingLayer, findImagePlaceholder]);

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
        handleQuickUploadTriggerHandled
    };
};