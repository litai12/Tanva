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

    // 处理快速图片上传 - 自动放置到坐标轴交叉点(0,0)
    const handleQuickImageUploaded = useCallback((imageData: string, fileName?: string) => {
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

                // 限制最大显示尺寸
                const maxSize = 400;
                let displayWidth = originalWidth;
                let displayHeight = originalHeight;

                if (originalWidth > maxSize || originalHeight > maxSize) {
                    const scale = Math.min(maxSize / originalWidth, maxSize / originalHeight);
                    displayWidth = originalWidth * scale;
                    displayHeight = originalHeight * scale;
                }

                // 设置显示尺寸
                raster.size = new paper.Size(displayWidth, displayHeight);

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
                        fillColor: handleColor,
                        strokeColor: 'white',
                        strokeWidth: 1,
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

                logger.upload(`✅ 快速上传成功：图片已添加到坐标原点 - ${fileName || 'uploaded-image'}`);
                paper.view.update();
            };

            raster.onError = () => {
                logger.error('图片加载失败');
            };
        } catch (error) {
            logger.error('快速上传图片时出错:', error);
            console.error('快速上传图片时出错:', error);
        }
    }, [ensureDrawingLayer]);

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