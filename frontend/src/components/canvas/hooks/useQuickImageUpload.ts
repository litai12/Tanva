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

    // 🔥 追踪正在加载中的图片（防止连续生成时位置重叠）
    type PendingImageEntry = {
        id: string;
        operationType?: string;
        expectedWidth: number;
        expectedHeight: number;
        x: number;
        y: number;
        placeholderId?: string;
        videoInfo?: {
            videoUrl: string;
            sourceUrl?: string;
            thumbnailUrl?: string;
            prompt?: string;
            durationSeconds?: number;
            sid?: string;
        };
    };

    const pendingImagesRef = useRef<Array<PendingImageEntry>>([]);
    const predictedPlaceholdersRef = useRef<Map<string, paper.Item>>(new Map());

    const upsertPendingImage = useCallback((entry: PendingImageEntry) => {
        if (!entry?.id) return;
        const list = pendingImagesRef.current;
        const index = list.findIndex((item) => item.id === entry.id);
        if (index >= 0) {
            list[index] = { ...list[index], ...entry };
        } else {
            list.push(entry);
        }
    }, []);

    const removePendingImage = useCallback((id?: string) => {
        if (!id) return;
        pendingImagesRef.current = pendingImagesRef.current.filter((item) => item.id !== id);
    }, []);

    const removePredictedPlaceholder = useCallback((placeholderId: string | undefined | null) => {
        if (!placeholderId) return;
        const existing = predictedPlaceholdersRef.current.get(placeholderId);
        if (existing) {
            // 清理旋转动画
            const animationId = (existing as any)._spinnerAnimationId;
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            if (existing.parent) {
                existing.remove();
            }
        }
        predictedPlaceholdersRef.current.delete(placeholderId);
        removePendingImage(placeholderId);
    }, [removePendingImage]);

    // 更新占位符进度
    const updatePlaceholderProgress = useCallback((placeholderId: string, progress: number) => {
        if (!placeholderId) return;
        const existing = predictedPlaceholdersRef.current.get(placeholderId);
        if (!existing || !existing.parent) return;

        // 查找进度标签并更新
        const progressLabel = existing.data?.progressLabelElement as paper.PointText | undefined;
        if (progressLabel && progressLabel.parent) {
            progressLabel.content = `${progress.toFixed(1)}%`;
            paper.view?.update();
        }
    }, []);

    // ========== 智能排版工具函数 ==========
    
    // 获取画布上所有图像的位置信息（包括正在加载中的）
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

            // 🔥 加入待加载图片的预估信息（防止重叠）
            for (const pending of pendingImagesRef.current) {
                images.push({
                    id: pending.id,
                    x: pending.x,
                    y: pending.y,
                    width: pending.expectedWidth,
                    height: pending.expectedHeight,
                    operationType: pending.operationType
                });
            }
        } catch (error) {
            console.error('获取画布图像时出错:', error);
        }

        return images;
    }, []);

    // 根据ID查找特定图像
    const findImageById = useCallback((imageId: string) => {
        const images = getAllCanvasImages();
        return images.find(img => img.id === imageId);
    }, [getAllCanvasImages]);

    // 解决位置冲突：如果目标位置已有图片，则按业务规则依次偏移
    const findNonOverlappingPosition = useCallback((
        desiredPosition: paper.Point,
        expectedWidth: number,
        expectedHeight: number,
        operationType?: string,
        currentImageId?: string
    ): paper.Point => {
        const spacing = useUIStore.getState().smartPlacementOffset || 778;
        const verticalStep = Math.max(spacing, expectedHeight + 16);
        const horizontalStep = Math.max(spacing, expectedWidth + 16);
        const maxAttempts = 50;

        const doesOverlap = (point: paper.Point) => {
            const halfWidth = expectedWidth / 2;
            const halfHeight = expectedHeight / 2;
            const left = point.x - halfWidth;
            const right = point.x + halfWidth;
            const top = point.y - halfHeight;
            const bottom = point.y + halfHeight;

            const images = getAllCanvasImages();
            return images.some(img => {
                if (img.id === currentImageId) return false;
                const imgHalfWidth = img.width / 2;
                const imgHalfHeight = img.height / 2;
                const imgLeft = img.x - imgHalfWidth;
                const imgRight = img.x + imgHalfWidth;
                const imgTop = img.y - imgHalfHeight;
                const imgBottom = img.y + imgHalfHeight;

                return !(right <= imgLeft || left >= imgRight || bottom <= imgTop || top >= imgBottom);
            });
        };

        let position = desiredPosition.clone();
        let attempts = 0;

        while (doesOverlap(position) && attempts < maxAttempts) {
            attempts += 1;

            switch (operationType) {
                case 'edit':
                case 'blend':
                    position = position.add(new paper.Point(horizontalStep, 0));
                    break;
                case 'generate':
                case 'manual':
                default:
                    position = position.add(new paper.Point(0, verticalStep));
                    break;
            }
        }


        return position;
    }, [getAllCanvasImages]);

    // 计算智能排版位置
    const calculateSmartPosition = useCallback((
        operationType: string, 
        sourceImageId?: string,
        sourceImages?: string[],
        currentImageId?: string
    ) => {
        const getSpacing = () => useUIStore.getState().smartPlacementOffset || 778;
        const existingImages = getAllCanvasImages();

        switch (operationType) {
            case 'generate': {
                // 生成图：默认向下排列（若未提供smartPosition）
                const spacing = getSpacing();
                const genImages = existingImages.filter(img => 
                    img.operationType === 'generate' || !img.operationType
                );
                let index = genImages.length;
                if (currentImageId) {
                    const foundIndex = genImages.findIndex(img => img.id === currentImageId);
                    if (foundIndex >= 0) {
                        index = foundIndex;
                    }
                }
                const gpos = { x: 0, y: index * spacing };
                return gpos;
            }

            case 'edit': {
                // 编辑图：基于原图向右偏移
                const spacing = getSpacing();
                if (sourceImageId) {
                    const sourceImage = findImageById(sourceImageId);
                    if (sourceImage) {
                        const position = { x: sourceImage.x + spacing, y: sourceImage.y };
                        return position;
                    }
                }
                // 没有找到源图，默认向右偏移
                const editPosition = { x: spacing, y: 0 };
                return editPosition;
            }

            case 'blend': {
                // 融合图：基于第一张源图向右偏移
                const spacing = getSpacing();
                if (sourceImages && sourceImages.length > 0) {
                    const firstSourceImage = findImageById(sourceImages[0]);
                    if (firstSourceImage) {
                        const position = { x: firstSourceImage.x + spacing, y: firstSourceImage.y };
                        return position;
                    }
                }
                // 没有找到源图，默认向右偏移
                const blendPosition = { x: spacing, y: 0 };
                return blendPosition;
            }

            default:
                // 默认位置
                const defaultPosition = { x: 0, y: 0 };
                return defaultPosition;
        }
    }, [getAllCanvasImages, findImageById]);

    const showPredictedPlaceholder = useCallback((params: {
        placeholderId: string;
        center?: { x: number; y: number } | null;
        width: number;
        height: number;
        operationType?: string;
        retries?: number;
        preferSmartLayout?: boolean;
        smartPosition?: { x: number; y: number };
        sourceImageId?: string;
        sourceImages?: string[];
    }) => {
        if (!params?.placeholderId) return;

        if (!paper.project || !paper.view) {
            const retries = typeof params.retries === 'number' ? params.retries : 4;
            if (retries > 0) {
                setTimeout(() => showPredictedPlaceholder({ ...params, retries: retries - 1 }), 180);
            }
            return;
        }

        ensureDrawingLayer();

        const minSize = 48;
        const width = Math.max(params.width || 0, minSize);
        const height = Math.max(params.height || 0, minSize);

        const resolveCenter = (): { x: number; y: number } | null => {
            let base = params.center ?? params.smartPosition ?? null;

            if ((params.preferSmartLayout || !base) && typeof calculateSmartPosition === 'function') {
                const smart = calculateSmartPosition(
                    params.operationType || 'generate',
                    params.sourceImageId,
                    params.sourceImages,
                    params.placeholderId
                );
                if (smart && Number.isFinite(smart.x) && Number.isFinite(smart.y)) {
                    base = { x: smart.x, y: smart.y };
                }
            }

            if (!base && paper.view?.center) {
                base = { x: paper.view.center.x, y: paper.view.center.y };
            }

            return base;
        };

        const baseCenter = resolveCenter();
        if (!baseCenter) {
            console.warn('🎯 [QuickUpload] 占位符缺少中心点');
            return;
        }

        // 清理旧的同ID占位符
        removePredictedPlaceholder(params.placeholderId);

        const desiredPoint = new paper.Point(baseCenter.x, baseCenter.y);
        let centerPoint = desiredPoint;

        try {
            centerPoint = findNonOverlappingPosition(
                desiredPoint,
                width,
                height,
                params.operationType,
                params.placeholderId
            );
        } catch (e) {
            console.warn('🎯 [QuickUpload] 占位符防碰撞计算失败，使用原始位置', e);
        }

        const rect = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.subtract([width / 2, height / 2]),
                new paper.Size(width, height)
            ),
            strokeColor: new paper.Color('#60a5fa'),
            dashArray: [10, 8],
            strokeWidth: 1.2,
            fillColor: new paper.Color(0.9, 0.95, 1, 0.35)
        });

        // 创建加载动画圆弧
        const spinnerRadius = Math.min(width, height) * 0.08;
        const spinnerCenter = centerPoint.subtract([0, height * 0.1]);
        const spinner = new paper.Path.Arc({
            from: spinnerCenter.add([0, -spinnerRadius]),
            through: spinnerCenter.add([spinnerRadius, 0]),
            to: spinnerCenter.add([0, spinnerRadius]),
            strokeColor: new paper.Color('#3b82f6'),
            strokeWidth: 2.5,
            strokeCap: 'round'
        });

        const label = new paper.PointText({
            point: centerPoint.add([0, height * 0.15]),
            content: '正在生成',
            justification: 'center',
            fillColor: new paper.Color('#2563eb'),
            fontSize: Math.max(12, Math.min(16, width * 0.035)),
            fontWeight: 'bold'
        });

        const progressLabel = new paper.PointText({
            point: centerPoint.add([0, height * 0.25]),
            content: '0%',
            justification: 'center',
            fillColor: new paper.Color('#60a5fa'),
            fontSize: Math.max(10, Math.min(14, width * 0.03))
        });

        const group = new paper.Group([rect, spinner, label, progressLabel]);
        group.position = centerPoint;
        // 允许被选中拖动/删除
        group.locked = false;
        group.data = {
            type: 'image-placeholder',
            placeholderId: params.placeholderId,
            bounds: {
                x: centerPoint.x - width / 2,
                y: centerPoint.y - height / 2,
                width,
                height
            },
            isHelper: false,
            placeholderSource: 'ai-predict',
            operationType: params.operationType,
            spinnerElement: spinner,
            progressLabelElement: progressLabel
        };

        // 启动旋转动画
        let animationFrameId: number | null = null;
        const animateSpinner = () => {
            if (spinner && spinner.parent && group.parent) {
                spinner.rotate(8, spinnerCenter);
                paper.view.update();
                animationFrameId = requestAnimationFrame(animateSpinner);
            }
        };
        animationFrameId = requestAnimationFrame(animateSpinner);

        // 存储动画ID以便清理
        (group as any)._spinnerAnimationId = animationFrameId;

        predictedPlaceholdersRef.current.set(params.placeholderId, group);
        upsertPendingImage({
            id: params.placeholderId,
            expectedWidth: width,
            expectedHeight: height,
            x: centerPoint.x,
            y: centerPoint.y,
            operationType: params.operationType,
            placeholderId: params.placeholderId
        });

        paper.view.update();
    }, [calculateSmartPosition, ensureDrawingLayer, findNonOverlappingPosition, removePredictedPlaceholder, upsertPendingImage]);

    // ========== 查找画布中的图片占位框 ==========
    const findImagePlaceholder = useCallback((placeholderId?: string) => {
        try {
            if (placeholderId) {
                const existing = predictedPlaceholdersRef.current.get(placeholderId);
                if (existing) return existing;
            }

            if (!paper.project) return null;

            // 遍历所有图层查找占位框
            for (const layer of paper.project.layers) {
                for (const item of layer.children) {
                    if (item.data?.type === 'image-placeholder' && item.data?.bounds) {
                        if (!placeholderId || item.data?.placeholderId === placeholderId) {
                            return item;
                        }
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
        sourceImages?: string[],
        extraOptions?: {
            videoInfo?: PendingImageEntry['videoInfo'];
            placeholderId?: string;
        }
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

            const placeholderId = extraOptions?.placeholderId;
            const placeholder = findImagePlaceholder(placeholderId);
            const placeholderBounds = placeholder?.data?.bounds;
            const imageId = placeholderId || asset.id || `quick_image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const defaultExpectedSize = 768;
            const expectedWidth = placeholderBounds?.width ?? defaultExpectedSize;
            const expectedHeight = placeholderBounds?.height ?? defaultExpectedSize;
            const pendingOperationType = operationType || 'manual';
            let targetPosition: paper.Point;
            let pendingEntry: PendingImageEntry | null = null;

            const registerPending = (initialPoint: paper.Point | null) => {
                const entry: PendingImageEntry = {
                    id: imageId,
                    operationType: pendingOperationType,
                    expectedWidth,
                    expectedHeight,
                    x: initialPoint?.x ?? 0,
                    y: initialPoint?.y ?? 0,
                    videoInfo: extraOptions?.videoInfo,
                    placeholderId
                };
                upsertPendingImage(entry);
                return entry;
            };

            const placeholderCenter = placeholderBounds
                ? new paper.Point(
                    placeholderBounds.x + placeholderBounds.width / 2,
                    placeholderBounds.y + placeholderBounds.height / 2
                  )
                : null;

            const baseWidth = expectedWidth;
            const baseHeight = expectedHeight;

            if (smartPosition) {
                const desiredPoint = new paper.Point(smartPosition.x, smartPosition.y);
                pendingEntry = registerPending(desiredPoint);
                const adjustedPoint = findNonOverlappingPosition(desiredPoint, baseWidth, baseHeight, pendingOperationType, imageId);
                targetPosition = adjustedPoint;
                if (pendingEntry) {
                    pendingEntry.x = adjustedPoint.x;
                    pendingEntry.y = adjustedPoint.y;
                }
                if (!desiredPoint.equals(adjustedPoint)) {
                    logger.upload(`📍 快速上传：智能位置冲突，已调整至 (${adjustedPoint.x}, ${adjustedPoint.y})`);
                } else {
                    logger.upload(`📍 快速上传：使用智能位置 (${adjustedPoint.x}, ${adjustedPoint.y})`);
                }
            } else if (placeholderCenter) {
                pendingEntry = registerPending(placeholderCenter);
                const adjustedPoint = findNonOverlappingPosition(placeholderCenter, baseWidth, baseHeight, pendingOperationType, imageId);
                targetPosition = adjustedPoint;
                if (pendingEntry) {
                    pendingEntry.x = adjustedPoint.x;
                    pendingEntry.y = adjustedPoint.y;
                }
                if (!placeholderCenter.equals(adjustedPoint)) {
                    logger.upload(`📍 快速上传：占位符位置冲突，已调整至 (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                } else {
                    logger.upload(`📍 快速上传：使用占位符位置 (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                }
            } else if (operationType) {
                pendingEntry = registerPending(null);
                const calculated = calculateSmartPosition(operationType, sourceImageId, sourceImages, imageId);
                const desiredPoint = new paper.Point(calculated.x, calculated.y);
                if (pendingEntry) {
                    pendingEntry.x = desiredPoint.x;
                    pendingEntry.y = desiredPoint.y;
                }
                const adjustedPoint = findNonOverlappingPosition(desiredPoint, baseWidth, baseHeight, operationType, imageId);
                targetPosition = adjustedPoint;
                if (pendingEntry) {
                    pendingEntry.x = adjustedPoint.x;
                    pendingEntry.y = adjustedPoint.y;
                }
                if (!desiredPoint.equals(adjustedPoint)) {
                    logger.upload(`📍 快速上传：智能计算位置 (${desiredPoint.x}, ${desiredPoint.y}) → 调整为 (${adjustedPoint.x}, ${adjustedPoint.y}) 操作类型: ${operationType}`);
                } else {
                    logger.upload(`📍 快速上传：计算智能位置 (${adjustedPoint.x}, ${adjustedPoint.y}) 操作类型: ${operationType}`);
                }
            } else {
                const centerSource = paper.view && (paper.view as any).center
                    ? (paper.view as any).center
                    : new paper.Point(0, 0);
                const centerPoint = new paper.Point(centerSource.x, centerSource.y);
                pendingEntry = registerPending(centerPoint);
                const adjustedPoint = findNonOverlappingPosition(centerPoint, baseWidth, baseHeight, 'manual', imageId);
                targetPosition = adjustedPoint;
                if (pendingEntry) {
                    pendingEntry.x = adjustedPoint.x;
                    pendingEntry.y = adjustedPoint.y;
                    pendingEntry.operationType = 'manual';
                }
                if (!centerPoint.equals(adjustedPoint)) {
                    logger.upload(`📍 快速上传：视口中心冲突，已调整至 (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                } else {
                    logger.upload(`📍 快速上传：默认使用视口中心 (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                }
            }

            // 创建加载指示器（转圈动画）
            const loadingIndicatorSize = 48;
            const loadingGroup = new paper.Group();
            loadingGroup.position = targetPosition;
            loadingGroup.data = { type: 'loading-indicator', imageId };

            // 创建背景圆形
            const bgCircle = new paper.Path.Circle({
                center: new paper.Point(0, 0),
                radius: loadingIndicatorSize / 2,
                fillColor: new paper.Color(1, 1, 1, 0.9),
                strokeColor: new paper.Color(0.9, 0.9, 0.9),
                strokeWidth: 1
            });
            loadingGroup.addChild(bgCircle);

            // 创建旋转的弧形（loading spinner）
            const arcRadius = loadingIndicatorSize / 2 - 8;
            const loadingArc = new paper.Path.Arc({
                from: new paper.Point(0, -arcRadius),
                through: new paper.Point(arcRadius, 0),
                to: new paper.Point(0, arcRadius),
                strokeColor: new paper.Color('#3b82f6'),
                strokeWidth: 3,
                strokeCap: 'round'
            });
            loadingGroup.addChild(loadingArc);

            // 添加到画布
            paper.project.activeLayer.addChild(loadingGroup);
            paper.view.update();

            // 启动旋转动画
            let rotationAngle = 0;
            let animationFrameId: number | null = null;
            const animateLoading = () => {
                if (loadingGroup && loadingGroup.parent) {
                    rotationAngle += 6;
                    loadingArc.rotate(6, new paper.Point(0, 0));
                    paper.view.update();
                    animationFrameId = requestAnimationFrame(animateLoading);
                }
            };
            animationFrameId = requestAnimationFrame(animateLoading);

            // 移除加载指示器的函数
            const removeLoadingIndicator = () => {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
                if (loadingGroup && loadingGroup.parent) {
                    loadingGroup.remove();
                    paper.view.update();
                }
            };

            // 创建图片的 Raster 对象（先绑定 onLoad 再设置 source，避免极快缓存触发导致丢失回调）
            const raster = new paper.Raster();
            (raster as any).crossOrigin = 'anonymous';
            raster.position = targetPosition;


            // 等待图片加载完成
            raster.onLoad = () => {
                // 移除加载指示器
                removeLoadingIndicator();

                if (!asset) {
                    logger.error('快速上传：缺少图片资源');
                    return;
                }

                // 🔥 从待加载列表中移除此图片
                pendingImagesRef.current = pendingImagesRef.current.filter(p => p.id !== imageId);
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
                    placeholder = findImagePlaceholder(placeholderId);
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
                        if (!smartPosition) {
                            finalPosition = targetCenter;
                        } else {
                            finalPosition = targetPosition;
                        }
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
                        if (!smartPosition) {
                            finalPosition = targetCenter;
                        } else {
                            finalPosition = targetPosition;
                        }
                    }

                    // 删除占位框（如果存在）
                    if (placeholderId) {
                        removePredictedPlaceholder(placeholderId);
                    } else if (placeholder) {
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
                    sourceImages: sourceImages,
                    videoInfo: extraOptions?.videoInfo
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
                        nodeType: 'image',
                        projectId: projectId ?? null
                    });
                } catch (historyError) {
                    // 忽略历史记录错误
                }

                const positionInfo = selectedImageBounds ? '选中图片位置' : (placeholder ? '占位框位置' : '坐标原点');
                logger.upload(`✅ 快速上传成功：图片已添加到${positionInfo} - ${fileName || 'uploaded-image'}`);
                try { historyService.commit('add-image').catch(() => {}); } catch {}

                // 若图片落点不在当前视口内，自动将视口平移到图片中心，避免"已成功但看不见"的困扰
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
                    }
                } catch (e) {
                    // 忽略自动居中错误
                }
                if (placeholderId) {
                    removePredictedPlaceholder(placeholderId);
                }
                paper.view.update();
            };

            raster.onError = (e: any) => {
                // 移除加载指示器
                removeLoadingIndicator();
                pendingImagesRef.current = pendingImagesRef.current.filter(p => p.id !== imageId);
                if (placeholderId) {
                    removePredictedPlaceholder(placeholderId);
                }
                logger.error('图片加载失败');
            };

            // 触发加载
            raster.source = imageData;
        } catch (error) {
            logger.error('快速上传图片时出错:', error);
            console.error('快速上传图片时出错:', error);
        }
    }, [ensureDrawingLayer, calculateSmartPosition, findImagePlaceholder, findNonOverlappingPosition, projectId, removePredictedPlaceholder, upsertPendingImage]);

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
        showPredictedPlaceholder,
        removePredictedPlaceholder,
        updatePlaceholderProgress,
        // 智能排版相关函数
        calculateSmartPosition,
        getAllCanvasImages,
        findImageById
    };
};
