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
import { isRaster } from '@/utils/paperCoords';
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

// 图片加载超时时间，防止占位框长时间悬挂
const IMAGE_LOAD_TIMEOUT = 20000; // 20s

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

        // 查找进度标签并更新 - 使用索引而不是直接引用
        const progressLabelIndex = existing.data?.progressLabelIndex as number | undefined;
        const progressLabel = (progressLabelIndex !== undefined && existing.children)
            ? existing.children[progressLabelIndex] as paper.PointText | undefined
            : undefined;
        if (progressLabel && progressLabel.parent) {
            progressLabel.content = `${progress.toFixed(1)}%`;
            paper.view?.update();
        }
    }, []);

    // 🔥 生成类图片的行排布状态，确保 X4 等并行批次横向排版、批次之间按行下移
    const generationLayoutRef = useRef<{
        baseAnchor: { x: number; y: number } | null;
        nextRow: number;
        rowAssignments: Map<string, { rowIndex: number; rowSpan: number; columns: number }>;
    }>({
        baseAnchor: null,
        nextRow: 0,
        rowAssignments: new Map(),
    });

    const allocateRowForBatch = useCallback((batchKey: string, columns: number, rowsNeeded: number) => {
        const state = generationLayoutRef.current;
        let assignment = state.rowAssignments.get(batchKey);
        if (!assignment) {
            assignment = { rowIndex: state.nextRow, rowSpan: rowsNeeded, columns };
            state.rowAssignments.set(batchKey, assignment);
            state.nextRow += rowsNeeded;
        }
        return assignment;
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
                            raster = item.children.find(child => isRaster(child)) as paper.Raster;
                            bounds = raster?.bounds || item.bounds;
                        } else if (isRaster(item)) {
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
        currentImageId?: string,
        preferHorizontal?: boolean  // 🔥 新增：是否优先横向排列
    ): paper.Point => {
        const spacing = useUIStore.getState().smartPlacementOffset || 522;
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

            // 🔥 如果指定了横向排列优先，或者是 edit/blend 类型，则横向偏移
            if (preferHorizontal || operationType === 'edit' || operationType === 'blend') {
                position = position.add(new paper.Point(horizontalStep, 0));
            } else {
                // generate/manual 默认向下偏移
                position = position.add(new paper.Point(0, verticalStep));
            }
        }


        return position;
    }, [getAllCanvasImages]);

    // 计算智能排版位置
    const calculateSmartPosition = useCallback((
        operationType: string, 
        sourceImageId?: string,
        sourceImages?: string[],
        currentImageId?: string,
        layoutContext?: {
            groupId?: string;
            groupIndex?: number;
            groupTotal?: number;
            anchorCenter?: { x: number; y: number } | null;
            preferHorizontal?: boolean;
        }
    ) => {
        const getSpacing = () => useUIStore.getState().smartPlacementOffset || 522;
        const existingImages = getAllCanvasImages();

        // 如果画布上没有任何图片，重置行分配状态，避免旧状态干扰
        if (existingImages.length === 0 && pendingImagesRef.current.length === 0) {
            generationLayoutRef.current.rowAssignments.clear();
            generationLayoutRef.current.nextRow = 0;
            generationLayoutRef.current.baseAnchor = null;
        }

        switch (operationType) {
            case 'generate': {
                const spacing = getSpacing();
                const viewCenter = paper.view?.center ?? new paper.Point(0, 0);

                // 如果已有同名占位符，直接复用其位置，避免重复计算导致跳动
                if (currentImageId && currentImageId.startsWith('ai-placeholder-')) {
                    const placeholder = predictedPlaceholdersRef.current.get(currentImageId);
                    if (placeholder && placeholder.data?.bounds) {
                        const bounds = placeholder.data.bounds;
                        return {
                            x: bounds.x + bounds.width / 2,
                            y: bounds.y + bounds.height / 2
                        };
                    }
                }

                const groupId = layoutContext?.groupId;
                const groupIndex = Math.max(0, layoutContext?.groupIndex ?? 0);
                const groupTotal = Math.max(1, layoutContext?.groupTotal ?? 1);
                // X4 等并行模式：一行展示 groupTotal 张（最多 4 张），后续批次自动换行
                const columns = groupTotal > 1 ? Math.min(4, Math.max(1, groupTotal)) : 1;
                const rowsNeeded = Math.max(1, Math.ceil(groupTotal / columns));
                const batchKey = groupId || currentImageId || `generate-${existingImages.length}-${Date.now()}`;

                // 初始化全局锚点：优先使用传入的 groupAnchor/center，其次视口中心
                if (!generationLayoutRef.current.baseAnchor) {
                    const anchor = layoutContext?.anchorCenter;
                    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                        generationLayoutRef.current.baseAnchor = { x: anchor.x, y: anchor.y };
                    } else {
                        generationLayoutRef.current.baseAnchor = { x: viewCenter.x, y: viewCenter.y };
                    }
                }
                const anchor = generationLayoutRef.current.baseAnchor ?? { x: viewCenter.x, y: viewCenter.y };

                // 为当前批次分配行号，确保每批次占用独立行
                const assignment = allocateRowForBatch(batchKey, columns, rowsNeeded);
                const rowIndex = assignment.rowIndex + Math.floor(groupIndex / columns);
                const colIndex = Math.min(columns - 1, Math.max(0, groupIndex % columns));

                return {
                    x: anchor.x + (colIndex - (columns - 1) / 2) * spacing,
                    y: anchor.y + rowIndex * spacing
                };
            }

            case 'edit': {
                const spacing = getSpacing();
                const groupTotal = Math.max(1, layoutContext?.groupTotal ?? 1);
                const groupIndex = Math.max(0, layoutContext?.groupIndex ?? 0);
                const columns = groupTotal > 1 ? Math.min(4, groupTotal) : 1;

                // 并行编辑：按行列排布，锚点优先用传入 anchor，其次源图中心，最后视口中心
                if (groupTotal > 1) {
                    const sourceImage = sourceImageId ? findImageById(sourceImageId) : null;
                    const anchor = layoutContext?.anchorCenter
                        || (sourceImage ? { x: sourceImage.x, y: sourceImage.y } : null)
                        || (paper.view?.center ? { x: paper.view.center.x, y: paper.view.center.y } : { x: 0, y: 0 });

                    const rowIndex = Math.floor(groupIndex / columns);
                    const colIndex = groupIndex % columns;

                    return {
                        x: anchor.x + (colIndex - (columns - 1) / 2) * spacing,
                        y: anchor.y + rowIndex * spacing
                    };
                }

                // 单张编辑：沿用原逻辑向右偏移源图
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
    }, [getAllCanvasImages, findImageById, allocateRowForBatch]);

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
        groupId?: string;
        groupIndex?: number;
        groupTotal?: number;
        preferHorizontal?: boolean;
        groupAnchor?: { x: number; y: number } | null;
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
        const preferHorizontal = params.preferHorizontal || (params.groupTotal ?? 1) > 1;
        const layoutContext = {
            groupId: params.groupId,
            groupIndex: params.groupIndex,
            groupTotal: params.groupTotal,
            anchorCenter: params.groupAnchor ?? params.center ?? params.smartPosition ?? null,
            preferHorizontal
        };

        const resolveCenter = (): { x: number; y: number } | null => {
            let base = params.center ?? params.smartPosition ?? null;

            if ((params.preferSmartLayout || !base) && typeof calculateSmartPosition === 'function') {
                const smart = calculateSmartPosition(
                    params.operationType || 'generate',
                    params.sourceImageId,
                    params.sourceImages,
                    params.placeholderId,
                    layoutContext
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
                params.placeholderId,
                preferHorizontal
            );
        } catch (e) {
            console.warn('🎯 [QuickUpload] 占位符防碰撞计算失败，使用原始位置', e);
        }

        // ========== Agent 风格占位符 - 内部动效设计 ==========
        const halfW = width / 2;
        const halfH = height / 2;
        const cornerRadius = Math.min(width, height) * 0.02;
        const mainColor = new paper.Color('#4b5563'); // 黑灰色

        // 背景矩形
        // 背景 - 更深的灰色调
        const bg = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.subtract([halfW, halfH]),
                new paper.Size(width, height)
            ),
            radius: cornerRadius,
            fillColor: new paper.Color(0.58, 0.64, 0.72, 0.25) // slate-400 色调
        });

        // 静态边框 - 虚线样式
        const border = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.subtract([halfW, halfH]),
                new paper.Size(width, height)
            ),
            radius: cornerRadius,
            strokeColor: new paper.Color(0.39, 0.45, 0.55, 0.4), // slate-500 色调
            strokeWidth: 1,
            dashArray: [6, 4], // 虚线
            fillColor: null as any
        });

        // 渐变光晕扫过效果（从左到右移动）
        const shimmerWidth = width * 0.35; // 光晕宽度
        const shimmerStartX = centerPoint.x - halfW - shimmerWidth;
        const shimmer = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                new paper.Point(shimmerStartX, centerPoint.y - halfH + 5),
                new paper.Size(shimmerWidth, height - 10)
            ),
            fillColor: new paper.Color({
                gradient: {
                    stops: [
                        [new paper.Color(1, 1, 1, 0), 0],
                        [new paper.Color(1, 1, 1, 0.4), 0.3],
                        [new paper.Color(1, 1, 1, 0.7), 0.5],
                        [new paper.Color(1, 1, 1, 0.4), 0.7],
                        [new paper.Color(1, 1, 1, 0), 1]
                    ]
                },
                origin: new paper.Point(shimmerStartX, centerPoint.y),
                destination: new paper.Point(shimmerStartX + shimmerWidth, centerPoint.y)
            })
        });

        // 创建裁剪蒙版，限制光晕在占位框内显示
        const clipMask = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.subtract([halfW, halfH]),
                new paper.Size(width, height)
            ),
            radius: cornerRadius,
            clipMask: true
        });

        // 将光晕和裁剪蒙版放入一个组
        const shimmerGroup = new paper.Group([clipMask, shimmer]);

        // 内部扫描线（保留但调整颜色）
        const scanLineY = -halfH + 10;
        const scanLine = new paper.Path.Line({
            from: centerPoint.add([-halfW + 15, scanLineY]),
            to: centerPoint.add([halfW - 15, scanLineY]),
            strokeColor: {
                gradient: {
                    stops: [
                        [new paper.Color(0.39, 0.45, 0.55, 0), 0],
                        [new paper.Color(0.39, 0.45, 0.55, 0.5), 0.5],
                        [new paper.Color(0.39, 0.45, 0.55, 0), 1]
                    ]
                },
                origin: centerPoint.add([-halfW + 15, scanLineY]),
                destination: centerPoint.add([halfW - 15, scanLineY])
            } as any,
            strokeWidth: 2,
            strokeCap: 'round',
            visible: false // 隐藏扫描线，只用光晕效果
        });

        // 底部进度条（在框内）
        const barWidth = width * 0.5;
        const barHeight = 3;
        const barY = halfH - 25;
        const barBg = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.add([-barWidth / 2, barY]),
                new paper.Size(barWidth, barHeight)
            ),
            radius: barHeight / 2,
            fillColor: new paper.Color(0.9, 0.9, 0.92, 0.6)
        });

        const barFg = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.add([-barWidth / 2, barY]),
                new paper.Size(0, barHeight)  // 初始宽度为0，避免显示小圆点
            ),
            radius: barHeight / 2,
            fillColor: mainColor
        });

        // 进度文字
        const progressLabel = new paper.PointText({
            point: centerPoint.add([0, barY + 18]),
            content: '0%',
            justification: 'center',
            fillColor: new paper.Color('#6b7280'),
            fontSize: Math.max(14, Math.min(18, width * 0.028)),
            fontWeight: '600',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });

        const group = new paper.Group([bg, border, shimmerGroup, scanLine, barBg, barFg, progressLabel]);
        group.position = centerPoint;
        group.locked = true; // 占位框仅作为指示元素，不允许用户直接选择/拖拽
        group.data = {
            type: 'image-placeholder',
            placeholderId: params.placeholderId,
            bounds: {
                x: centerPoint.x - halfW,
                y: centerPoint.y - halfH,
                width,
                height
            },
            isHelper: true,
            placeholderSource: 'ai-predict',
            operationType: params.operationType,
            // 🔥 不再存储 Paper.js 元素引用，避免循环引用导致序列化失败
            // spinnerElement: scanLine,
            // progressLabelElement: progressLabel,
            // progressBarElement: barFg,
            progressBarWidth: barWidth,
            shimmerWidth: shimmerWidth,
            // 🔥 存储子元素索引而不是引用
            shimmerIndex: 2,        // shimmer 在 group.children 中的索引
            spinnerIndex: 3,        // scanLine 在 group.children 中的索引
            progressLabelIndex: 6,  // progressLabel 在 group.children 中的索引
            progressBarIndex: 5     // barFg 在 group.children 中的索引
        };

        // 标记所有占位元素为辅助，防止被选择/拖拽
        const attachPlaceholderMeta = (item: paper.Item | null | undefined) => {
            if (!item) return;
            item.data = {
                ...(item.data || {}),
                // 🔥 不再存储对 group 的引用，避免循环引用
                // placeholderGroup: group,
                placeholderGroupId: params.placeholderId, // 使用 ID 而不是引用
                placeholderType: 'image',
                placeholderId: params.placeholderId,
                isHelper: true
            };
            item.locked = true;
        };
        group.children?.forEach((child: paper.Item) => attachPlaceholderMeta(child));
        attachPlaceholderMeta(group);

        // 动画
        let animationFrameId: number | null = null;
        let animationTime = 0;
        const animationDuration = 2; // 2秒一个周期
        const totalDistance = width + shimmerWidth * 2; // 总移动距离

        const animate = () => {
            if (!group?.parent || !shimmer?.parent) return;
            animationTime += 0.016;

            // 光晕从左到右扫过效果
            const shimmerProgress = (animationTime % animationDuration) / animationDuration; // 0-1 循环
            const startX = centerPoint.x - halfW - shimmerWidth;
            const currentX = startX + shimmerProgress * totalDistance;

            // 移动 shimmer 元素（shimmer 在 shimmerGroup 内，需要设置其 x 位置）
            shimmer.position = new paper.Point(currentX + shimmerWidth / 2, centerPoint.y);

            paper.view.update();
            animationFrameId = requestAnimationFrame(animate);
        };
        animationFrameId = requestAnimationFrame(animate);

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

        // 🎯 自动将视角平移到占位框位置，确保用户能看到正在生成的图片
        try {
            const viewBounds = paper.view.bounds;
            const placeholderBounds = new paper.Rectangle(
                centerPoint.x - halfW,
                centerPoint.y - halfH,
                width,
                height
            );

            // 检查占位框是否在当前视口内
            const isInView = viewBounds && viewBounds.intersects(placeholderBounds);

            if (!isInView) {
                // 占位框不在视口内，自动平移视角到占位框中心
                const { zoom: currentZoom, setPan } = useCanvasStore.getState();
                const viewSize = paper.view.viewSize;
                const screenCenterX = viewSize.width / 2;
                const screenCenterY = viewSize.height / 2;

                // 计算需要的平移量，使占位框中心位于屏幕中心
                const desiredPanX = (screenCenterX / currentZoom) - centerPoint.x;
                const desiredPanY = (screenCenterY / currentZoom) - centerPoint.y;

                setPan(desiredPanX, desiredPanY);
                logger.debug(`🎯 自动聚焦视角到占位框: (${centerPoint.x.toFixed(1)}, ${centerPoint.y.toFixed(1)})`);
            }
        } catch (e) {
            // 忽略自动聚焦错误，不影响主流程
            console.warn('自动聚焦视角失败:', e);
        }
    }, [calculateSmartPosition, ensureDrawingLayer, findNonOverlappingPosition, removePredictedPlaceholder, upsertPendingImage]);

    // ========== 查找画布中的图片占位框 ==========
    const findImagePlaceholder = useCallback((placeholderId?: string) => {
        try {
            if (placeholderId) {
                const existing = predictedPlaceholdersRef.current.get(placeholderId);
                if (existing) {
                    console.log(`✅ [findImagePlaceholder] 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`);
                    return existing;
                }
            }

            if (!paper.project) {
                console.warn(`⚠️ [findImagePlaceholder] Paper.js 项目未初始化，placeholderId: ${placeholderId}`);
                return null;
            }

            // 遍历所有图层查找占位框
            for (const layer of paper.project.layers) {
                for (const item of layer.children) {
                    if (item.data?.type === 'image-placeholder' && item.data?.bounds) {
                        if (!placeholderId || item.data?.placeholderId === placeholderId) {
                            console.log(`✅ [findImagePlaceholder] 从图层中找到占位符: ${placeholderId || 'any'}`);
                            return item;
                        }
                    }
                }
            }
            
            if (placeholderId) {
                console.warn(`⚠️ [findImagePlaceholder] 未找到占位符: ${placeholderId}，当前占位符数量: ${predictedPlaceholdersRef.current.size}`);
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
            preferHorizontal?: boolean;  // 🔥 新增：是否优先横向排列
        }
    ) => {
        if (!imagePayload) {
            logger.error('快速上传未收到图片数据');
            if (extraOptions?.placeholderId) {
                removePredictedPlaceholder(extraOptions.placeholderId);
            }
            return;
        }

        let asset: StoredImageAsset | null = null;
        if (typeof imagePayload === 'string') {
            // 🔥 检查是否是远程 URL 还是 base64 data URL
            const isRemoteUrl = imagePayload.startsWith('http://') || imagePayload.startsWith('https://');
            
            if (isRemoteUrl) {
                // 如果是远程 URL，直接使用，不需要上传
                console.log(`🌐 [handleQuickImageUploaded] 检测到远程 URL，直接使用: ${imagePayload.substring(0, 50)}...`);
                asset = {
                    id: `remote_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    url: imagePayload,
                    src: imagePayload,
                    fileName: fileName || 'remote-image.png',
                    pendingUpload: false,
                };
            } else {
                // 如果是 base64 data URL，执行上传流程
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
            let placeholder = findImagePlaceholder(placeholderId);
            // 🔥 如果第一次查找失败，尝试从 predictedPlaceholdersRef 直接获取
            if (!placeholder && placeholderId) {
                const placeholderFromRef = predictedPlaceholdersRef.current.get(placeholderId);
                if (placeholderFromRef) {
                    placeholder = placeholderFromRef;
                    logger.upload(`🎯 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`);
                }
            }
            const placeholderBounds = placeholder?.data?.bounds;
            const imageId = placeholderId || asset.id || `quick_image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const defaultExpectedSize = 512;
            const expectedWidth = placeholderBounds?.width ?? defaultExpectedSize;
            const expectedHeight = placeholderBounds?.height ?? defaultExpectedSize;
            const pendingOperationType = operationType || 'manual';
            const preferHorizontal = extraOptions?.preferHorizontal ?? false;  // 🔥 获取横向排列偏好
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
                const adjustedPoint = findNonOverlappingPosition(desiredPoint, baseWidth, baseHeight, pendingOperationType, imageId, preferHorizontal);
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
                targetPosition = placeholderCenter; // 严格按占位符落点，不做防碰撞偏移
                if (pendingEntry) {
                    pendingEntry.x = placeholderCenter.x;
                    pendingEntry.y = placeholderCenter.y;
                }
                logger.upload(`📍 快速上传：使用占位符原位置 (${placeholderCenter.x.toFixed(1)}, ${placeholderCenter.y.toFixed(1)})`);
            } else if (operationType) {
                pendingEntry = registerPending(null);
                const calculated = calculateSmartPosition(operationType, sourceImageId, sourceImages, imageId);
                const desiredPoint = new paper.Point(calculated.x, calculated.y);
                if (pendingEntry) {
                    pendingEntry.x = desiredPoint.x;
                    pendingEntry.y = desiredPoint.y;
                }
                const adjustedPoint = findNonOverlappingPosition(desiredPoint, baseWidth, baseHeight, operationType, imageId, preferHorizontal);
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
                const adjustedPoint = findNonOverlappingPosition(centerPoint, baseWidth, baseHeight, 'manual', imageId, preferHorizontal);
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

            // 超时兜底，防止网络问题导致占位框一直存在
            let loadTimeoutId: number | null = window.setTimeout(() => {
                logger.error('图片加载超时，已取消', { imageId, placeholderId });
                removeLoadingIndicator();
                pendingImagesRef.current = pendingImagesRef.current.filter(p => p.id !== imageId);
                if (placeholderId) {
                    removePredictedPlaceholder(placeholderId);
                }
                try { raster.remove(); } catch {}
            }, IMAGE_LOAD_TIMEOUT);

            // 等待图片加载完成
            raster.onLoad = () => {
                if (loadTimeoutId !== null) {
                    clearTimeout(loadTimeoutId);
                    loadTimeoutId = null;
                }
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

                // 🎯 优先使用占位符，只有在没有占位符时才回退到选中图片边界
                let targetBounds = null;
                let boundsSource: 'placeholder' | 'selected' | null = null;

                if (placeholderId) {
                    console.log(`🔍 [raster.onLoad] 查找占位符: ${placeholderId}`);
                    placeholder = findImagePlaceholder(placeholderId);
                    if (placeholder && placeholder.data?.bounds) {
                        targetBounds = placeholder.data.bounds;
                        boundsSource = 'placeholder';
                        console.log(`✅ [raster.onLoad] 找到占位符，bounds:`, targetBounds);
                    } else {
                        const placeholderFromRef = predictedPlaceholdersRef.current.get(placeholderId);
                        if (placeholderFromRef && placeholderFromRef.data?.bounds) {
                            placeholder = placeholderFromRef;
                            targetBounds = placeholderFromRef.data.bounds;
                            boundsSource = 'placeholder';
                            console.log(`✅ [raster.onLoad] 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`, targetBounds);
                            logger.upload(`🎯 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`);
                        } else {
                            console.warn(`⚠️ [raster.onLoad] 未找到占位符 ${placeholderId}，当前占位符数量: ${predictedPlaceholdersRef.current.size}`);
                            logger.upload(`⚠️ 未找到占位符 ${placeholderId}，将使用智能位置计算`);
                        }
                    }
                }

                if (!targetBounds && selectedImageBounds) {
                    targetBounds = selectedImageBounds;
                    boundsSource = 'selected';
                }

                if (targetBounds) {
                    const sourceType = boundsSource === 'selected' ? '选中图片边界' : '占位框';
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
                        console.log(`🗑️ [handleQuickImageUploaded] 准备移除占位符: ${placeholderId}`);
                        const placeholderBeforeRemove = findImagePlaceholder(placeholderId);
                        if (placeholderBeforeRemove) {
                            console.log(`✅ [handleQuickImageUploaded] 找到占位符，准备移除: ${placeholderId}`);
                            removePredictedPlaceholder(placeholderId);
                            console.log(`✅ [handleQuickImageUploaded] 已移除占位符: ${placeholderId}`);
                        } else {
                            console.warn(`⚠️ [handleQuickImageUploaded] 未找到占位符，无法移除: ${placeholderId}`);
                        }
                    } else if (placeholder) {
                        placeholder.remove();
                        logger.upload('🗑️ 已删除占位框（无ID）');
                    }
                } else {
                    // 没有占位框，使用原有的逻辑
                    // 🔥 如果提供了 placeholderId 但未找到占位符，尝试使用智能位置计算
                    if (placeholderId && operationType && !finalPosition) {
                        logger.upload(`⚠️ 占位符 ${placeholderId} 未找到，使用智能位置计算`);
                        try {
                            const calculated = calculateSmartPosition(operationType, sourceImageId, sourceImages, imageId);
                            const desiredPoint = new paper.Point(calculated.x, calculated.y);
                            // 使用 expectedWidth 和 expectedHeight，如果没有则使用原始尺寸
                            const widthForPosition = expectedWidth || originalWidth || 512;
                            const heightForPosition = expectedHeight || originalHeight || 512;
                            const adjustedPoint = findNonOverlappingPosition(desiredPoint, widthForPosition, heightForPosition, operationType, imageId, preferHorizontal);
                            finalPosition = adjustedPoint;
                            logger.upload(`📍 使用智能位置计算: (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                        } catch (error) {
                            console.error('智能位置计算失败:', error);
                            // 如果智能位置计算失败，使用默认位置
                            if (!finalPosition) {
                                finalPosition = targetPosition;
                            }
                        }
                    }
                    
                    if (!useOriginalSize) {
                    // 标准模式：限制最大显示尺寸，但保持原始长宽比
                    const maxSize = 512;
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

                const positionInfo = boundsSource === 'selected'
                    ? '选中图片位置'
                    : (placeholder ? '占位框位置' : '坐标原点');
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
                if (loadTimeoutId !== null) {
                    clearTimeout(loadTimeoutId);
                    loadTimeoutId = null;
                }
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
