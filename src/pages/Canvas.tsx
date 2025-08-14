import React, { useRef, useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore } from '@/stores';
import ZoomIndicator from '@/components/canvas/ZoomIndicator';

// 网格系统现在使用固定间距，通过Paper.js的缩放矩阵实现视觉缩放

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { 
        gridSize,
        zoom,
        panX,
        panY,
        setPan
    } = useCanvasStore();
    const { showGrid, showAxis } = useUIStore();

    useEffect(() => {
        if (!canvasRef.current) return;

        // 初始化Paper.js
        paper.setup(canvasRef.current);
        
        // 禁用Paper.js的默认交互行为
        if (paper.view) {
            paper.view.onMouseDown = null;
            paper.view.onMouseDrag = null;
            paper.view.onMouseUp = null;
            // Paper.js可能没有onMouseWheel属性，使用其他方式禁用
        }

        // 应用视口变换 - 使用Paper.js默认左上角坐标系
        const applyViewTransform = () => {
            // 构建新的变换矩阵，避免频繁重置
            const matrix = new paper.Matrix();
            matrix.scale(zoom);
            matrix.translate(panX, panY);
            paper.view.matrix = matrix;
        };
        
        // 设置画布大小
        const canvas = canvasRef.current;
        let isInitialized = false;
        
        const resizeCanvas = () => {
            const parent = canvas.parentElement;
            if (parent) {
                canvas.width = parent.clientWidth;
                canvas.height = parent.clientHeight;
                paper.view.viewSize.width = canvas.width;
                paper.view.viewSize.height = canvas.height;
                
                // 初始化时将坐标轴移动到画布中心（仅执行一次）
                if (!isInitialized) {
                    const centerX = canvas.width / 2;
                    const centerY = canvas.height / 2;
                    setPan(centerX, centerY);
                    isInitialized = true;
                } else {
                    // 应用视口变换
                    applyViewTransform();
                }
                
                // 重新绘制专业版网格
                createGrid(gridSize);
            }
        };

        // 专业版网格系统 - 支持视口裁剪的无限网格，固定间距
        const createGrid = (baseGridSize: number = 20) => {
            // 使用固定网格间距，通过缩放实现视觉变化
            const currentGridSize = baseGridSize;
            // 保存当前活动图层
            const previousActiveLayer = paper.project.activeLayer;

            // 找到或创建网格图层
            let gridLayer = paper.project.layers.find(l => l.name === "grid");
            if (!gridLayer) {
                gridLayer = new paper.Layer();
                gridLayer.name = "grid";
                gridLayer.sendToBack();
            }

            // 清空现有网格
            gridLayer.removeChildren();
            gridLayer.activate();

            // 如果网格和坐标轴都关闭，则不显示任何内容
            if (!showGrid && !showAxis) {
                return;
            }

            // 获取世界坐标系中的可视边界
            const viewBounds = paper.view.bounds;
            
            // 计算网格边界，扩展一点确保完全覆盖
            const padding = currentGridSize * 2;
            const minX = Math.floor((viewBounds.left - padding) / currentGridSize) * currentGridSize;
            const maxX = Math.ceil((viewBounds.right + padding) / currentGridSize) * currentGridSize;
            const minY = Math.floor((viewBounds.top - padding) / currentGridSize) * currentGridSize;
            const maxY = Math.ceil((viewBounds.bottom + padding) / currentGridSize) * currentGridSize;

            // 创建坐标轴（如果启用）- 固定在Paper.js (0,0)点
            if (showAxis) {
                // Y轴（蓝色竖直线）
                const yAxisLine = new paper.Path.Line({
                    from: [0, viewBounds.top - padding],
                    to: [0, viewBounds.bottom + padding],
                    strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0), // 蓝色Y轴
                    strokeWidth: 2.5,
                    data: { isAxis: true, axis: 'Y' }
                });
                gridLayer.addChild(yAxisLine);

                // X轴（红色水平线）
                const xAxisLine = new paper.Path.Line({
                    from: [viewBounds.left - padding, 0],
                    to: [viewBounds.right + padding, 0],
                    strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0), // 红色X轴
                    strokeWidth: 2.5,
                    data: { isAxis: true, axis: 'X' }
                });
                gridLayer.addChild(xAxisLine);
            }

            // 创建网格线（如果启用）- 只绘制可视区域内的网格线
            if (showGrid) {
                // 计算副网格显示阈值 - 当缩放小于30%时隐藏副网格
                const shouldShowMinorGrid = zoom >= 0.3;
                
                // 创建垂直网格线
                for (let x = minX; x <= maxX; x += currentGridSize) {
                    // 跳过轴线位置（如果显示轴线）
                    if (showAxis && x === 0) continue;
                    
                    // 计算是否为主网格线（每5条线）
                    const gridIndex = Math.round(x / currentGridSize);
                    const isMainGrid = gridIndex % 5 === 0;
                    
                    // 如果是副网格且缩放过小，则跳过
                    if (!isMainGrid && !shouldShowMinorGrid) continue;

                    const line = new paper.Path.Line({
                        from: [x, minY],
                        to: [x, maxY],
                        strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                        strokeWidth: isMainGrid ? 0.8 : 0.3
                    });
                    gridLayer.addChild(line);
                }

                // 创建水平网格线
                for (let y = minY; y <= maxY; y += currentGridSize) {
                    // 跳过轴线位置（如果显示轴线）
                    if (showAxis && y === 0) continue;
                    
                    // 计算是否为主网格线（每5条线）
                    const gridIndex = Math.round(y / currentGridSize);
                    const isMainGrid = gridIndex % 5 === 0;
                    
                    // 如果是副网格且缩放过小，则跳过
                    if (!isMainGrid && !shouldShowMinorGrid) continue;

                    const line = new paper.Path.Line({
                        from: [minX, y],
                        to: [maxX, y],
                        strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                        strokeWidth: isMainGrid ? 0.8 : 0.3
                    });
                    gridLayer.addChild(line);
                }
            }

            // 将网格层移到最底部
            gridLayer.sendToBack();

            // 恢复之前的活动图层
            if (previousActiveLayer && previousActiveLayer.name &&
                previousActiveLayer.name.startsWith('layer_')) {
                previousActiveLayer.activate();
            }
        };


        // 初始化画布
        resizeCanvas();

        // 监听窗口大小变化
        const handleResize = () => {
            setTimeout(resizeCanvas, 100);
        };
        window.addEventListener('resize', handleResize);

        // 画布交互功能 - 仅保留中键拖动
        let isDragging = false;
        let lastScreenPoint: { x: number, y: number } | null = null;
        let dragStartPanX = 0;
        let dragStartPanY = 0;

        // 鼠标事件处理
        const handleMouseDown = (event: MouseEvent) => {
            // 只响应中键（button === 1）
            if (event.button === 1) {
                event.preventDefault();
                isDragging = true;
                
                const rect = canvas.getBoundingClientRect();
                lastScreenPoint = {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top
                };
                
                // 获取当前最新的状态值
                const currentState = useCanvasStore.getState();
                dragStartPanX = currentState.panX;
                dragStartPanY = currentState.panY;
                canvas.style.cursor = 'grabbing';
            }
        };

        const handleMouseMove = (event: MouseEvent) => {
            if (isDragging && lastScreenPoint) {
                const rect = canvas.getBoundingClientRect();
                const currentScreenPoint = {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top
                };
                
                // 计算屏幕坐标增量
                const screenDeltaX = currentScreenPoint.x - lastScreenPoint.x;
                const screenDeltaY = currentScreenPoint.y - lastScreenPoint.y;
                
                // 转换为世界坐标增量（考虑当前缩放）
                const worldDeltaX = screenDeltaX / zoom;
                const worldDeltaY = screenDeltaY / zoom;
                
                // 更新平移值
                const newPanX = dragStartPanX + worldDeltaX;
                const newPanY = dragStartPanY + worldDeltaY;
                
                // 直接更新状态并重新绘制
                setPan(newPanX, newPanY);
            }
        };

        const handleMouseUp = (event: MouseEvent) => {
            if (event.button === 1 && isDragging) {
                isDragging = false;
                lastScreenPoint = null;
                canvas.style.cursor = 'default';
            }
        };

        // 添加事件监听器
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        
        // 阻止中键的默认行为（滚动）
        canvas.addEventListener('mousedown', (event) => {
            if (event.button === 1) {
                event.preventDefault();
            }
        });
        
        // 明确禁用滚轮事件，防止任何缩放行为
        const preventWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
        };
        canvas.addEventListener('wheel', preventWheel, { passive: false });


        return () => {
            window.removeEventListener('resize', handleResize);
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('wheel', preventWheel);
            paper.project.clear();
        };
    }, [gridSize, showGrid, showAxis]);

    // 单独处理视口变化，避免重新初始化整个画布
    useEffect(() => {
        if (!canvasRef.current) return;
        
        // 应用视口变换
        const matrix = new paper.Matrix();
        matrix.scale(zoom);
        matrix.translate(panX, panY);
        paper.view.matrix = matrix;
        
        // 重新绘制网格（使用统一的createGrid函数）
        if (showGrid || showAxis) {
            // 延迟一帧确保视口变换已生效
            requestAnimationFrame(() => {
                const gridLayer = paper.project.layers.find(l => l.name === "grid");
                if (gridLayer) {
                    gridLayer.removeChildren();
                    gridLayer.activate();
                    
                    // 使用固定网格间距
                    const dynamicGridSize = gridSize;
                    const viewBounds = paper.view.bounds;
                    const padding = dynamicGridSize * 2;
                    const minX = Math.floor((viewBounds.left - padding) / dynamicGridSize) * dynamicGridSize;
                    const maxX = Math.ceil((viewBounds.right + padding) / dynamicGridSize) * dynamicGridSize;
                    const minY = Math.floor((viewBounds.top - padding) / dynamicGridSize) * dynamicGridSize;
                    const maxY = Math.ceil((viewBounds.bottom + padding) / dynamicGridSize) * dynamicGridSize;

                    // 创建坐标轴（如果启用）
                    if (showAxis) {
                        // Y轴（蓝色竖直线）
                        const yAxisLine = new paper.Path.Line({
                            from: [0, viewBounds.top - padding],
                            to: [0, viewBounds.bottom + padding],
                            strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0),
                            strokeWidth: 2.5
                        });
                        gridLayer.addChild(yAxisLine);

                        // X轴（红色水平线）
                        const xAxisLine = new paper.Path.Line({
                            from: [viewBounds.left - padding, 0],
                            to: [viewBounds.right + padding, 0],
                            strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0),
                            strokeWidth: 2.5
                        });
                        gridLayer.addChild(xAxisLine);
                    }

                    // 创建网格线（如果启用）
                    if (showGrid) {
                        // 计算副网格显示阈值 - 当缩放小于30%时隐藏副网格
                        const shouldShowMinorGrid = zoom >= 0.3;
                        
                        for (let x = minX; x <= maxX; x += dynamicGridSize) {
                            if (showAxis && x === 0) continue;
                            
                            const gridIndex = Math.round(x / dynamicGridSize);
                            const isMainGrid = gridIndex % 5 === 0;
                            
                            // 如果是副网格且缩放过小，则跳过
                            if (!isMainGrid && !shouldShowMinorGrid) continue;

                            const line = new paper.Path.Line({
                                from: [x, minY],
                                to: [x, maxY],
                                strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                                strokeWidth: isMainGrid ? 0.8 : 0.3
                            });
                            gridLayer.addChild(line);
                        }

                        for (let y = minY; y <= maxY; y += dynamicGridSize) {
                            if (showAxis && y === 0) continue;
                            
                            const gridIndex = Math.round(y / dynamicGridSize);
                            const isMainGrid = gridIndex % 5 === 0;
                            
                            // 如果是副网格且缩放过小，则跳过
                            if (!isMainGrid && !shouldShowMinorGrid) continue;

                            const line = new paper.Path.Line({
                                from: [minX, y],
                                to: [maxX, y],
                                strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                                strokeWidth: isMainGrid ? 0.8 : 0.3
                            });
                            gridLayer.addChild(line);
                        }
                    }
                    
                    gridLayer.sendToBack();
                }
            });
        }
    }, [zoom, panX, panY, gridSize, showGrid, showAxis]);

    return (
        <div className="flex-1 relative overflow-hidden">
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                style={{ background: 'white' }}
            />
            <ZoomIndicator />
        </div>
    );
};

export default Canvas;