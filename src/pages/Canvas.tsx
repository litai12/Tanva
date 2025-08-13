import React, { useRef, useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore } from '@/stores';

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { 
        gridSize,
        zoom,
        panX,
        panY,
        setZoom,
        setPan,
        panBy
    } = useCanvasStore();
    const { showGrid, showAxis } = useUIStore();

    useEffect(() => {
        if (!canvasRef.current) return;

        // 初始化Paper.js
        paper.setup(canvasRef.current);

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
        const resizeCanvas = () => {
            const parent = canvas.parentElement;
            if (parent) {
                canvas.width = parent.clientWidth;
                canvas.height = parent.clientHeight;
                paper.view.viewSize.width = canvas.width;
                paper.view.viewSize.height = canvas.height;
                
                // 应用视口变换
                applyViewTransform();
                // 重新绘制专业版网格
                createGrid(gridSize);
            }
        };

        // 专业版网格系统 - 支持视口裁剪的无限网格
        const createGrid = (currentGridSize: number = 20) => {
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

            // 创建坐标轴（如果启用）- 固定在世界坐标原点，跟随拖拽移动
            if (showAxis) {
                // 检查Y轴是否在可视区域内
                if (0 >= viewBounds.left && 0 <= viewBounds.right) {
                    const yAxisLine = new paper.Path.Line({
                        from: [0, viewBounds.top - padding],
                        to: [0, viewBounds.bottom + padding],
                        strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0), // 蓝色Y轴
                        strokeWidth: 2.5,
                        data: { isAxis: true, axis: 'Y' }
                    });
                    gridLayer.addChild(yAxisLine);
                }

                // 检查X轴是否在可视区域内
                if (0 >= viewBounds.top && 0 <= viewBounds.bottom) {
                    const xAxisLine = new paper.Path.Line({
                        from: [viewBounds.left - padding, 0],
                        to: [viewBounds.right + padding, 0],
                        strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0), // 红色X轴
                        strokeWidth: 2.5,
                        data: { isAxis: true, axis: 'X' }
                    });
                    gridLayer.addChild(xAxisLine);
                }
            }

            // 创建网格线（如果启用）- 只绘制可视区域内的网格线
            if (showGrid) {
                // 创建垂直网格线
                for (let x = minX; x <= maxX; x += currentGridSize) {
                    // 跳过轴线位置（如果显示轴线）
                    if (showAxis && x === 0) continue;
                    
                    // 计算是否为主网格线（每5条线）
                    const gridIndex = Math.round(x / currentGridSize);
                    const isMainGrid = gridIndex % 5 === 0;

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

        // 添加无限画布交互功能
        let isDragging = false;
        let lastScreenPoint: { x: number, y: number } | null = null;
        let dragStartPanX = 0;
        let dragStartPanY = 0;

        const tool = new paper.Tool();

        // 鼠标按下 - 开始拖拽
        tool.onMouseDown = (event: paper.ToolEvent) => {
            isDragging = true;
            // 使用屏幕坐标而非Paper.js坐标
            const rect = canvas.getBoundingClientRect();
            const nativeEvent = event.event as MouseEvent;
            lastScreenPoint = {
                x: nativeEvent.clientX - rect.left,
                y: nativeEvent.clientY - rect.top
            };
            // 获取当前最新的状态值
            const currentState = useCanvasStore.getState();
            dragStartPanX = currentState.panX;
            dragStartPanY = currentState.panY;
            canvas.style.cursor = 'grabbing';
        };

        // 鼠标拖拽 - 平移视图（基于屏幕坐标）
        tool.onMouseDrag = (event: paper.ToolEvent) => {
            if (isDragging && lastScreenPoint) {
                // 获取当前屏幕坐标
                const rect = canvas.getBoundingClientRect();
                const nativeEvent = event.event as MouseEvent;
                const currentScreenPoint = {
                    x: nativeEvent.clientX - rect.left,
                    y: nativeEvent.clientY - rect.top
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

        // 鼠标释放 - 结束拖拽
        tool.onMouseUp = () => {
            isDragging = false;
            lastScreenPoint = null;
            canvas.style.cursor = 'grab';
        };

        // 鼠标悬停样式
        canvas.style.cursor = 'grab';

        // 滚轮缩放功能
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            
            // 计算缩放因子 - 更丝滑的缩放体验
            const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05;
            const newZoom = zoom * zoomFactor;
            
            // 获取鼠标在画布上的位置
            const rect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            
            // 转换为世界坐标
            const worldPoint = paper.view.viewToProject(new paper.Point(mouseX, mouseY));
            
            // 计算缩放中心偏移
            const scaleRatio = newZoom / zoom;
            const offsetX = (worldPoint.x - panX) * (1 - scaleRatio);
            const offsetY = (worldPoint.y - panY) * (1 - scaleRatio);
            
            // 更新缩放和平移
            setZoom(newZoom);
            panBy(offsetX, offsetY);
            
            // 应用变换和重绘
            setTimeout(() => {
                applyViewTransform();
                createGrid(gridSize);
            }, 0);
        };

        canvas.addEventListener('wheel', handleWheel, { passive: false });


        return () => {
            window.removeEventListener('resize', handleResize);
            canvas.removeEventListener('wheel', handleWheel);
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
        
        // 重新绘制网格（仅在显示时）
        if (showGrid || showAxis) {
            const gridLayer = paper.project.layers.find(l => l.name === "grid");
            if (gridLayer) {
                gridLayer.removeChildren();
                gridLayer.activate();
                
                // 重新创建网格
                const viewBounds = paper.view.bounds;
                const padding = gridSize * 2;
                const minX = Math.floor((viewBounds.left - padding) / gridSize) * gridSize;
                const maxX = Math.ceil((viewBounds.right + padding) / gridSize) * gridSize;
                const minY = Math.floor((viewBounds.top - padding) / gridSize) * gridSize;
                const maxY = Math.ceil((viewBounds.bottom + padding) / gridSize) * gridSize;

                // 创建坐标轴（如果启用）
                if (showAxis) {
                    if (0 >= viewBounds.left && 0 <= viewBounds.right) {
                        const yAxisLine = new paper.Path.Line({
                            from: [0, viewBounds.top - padding],
                            to: [0, viewBounds.bottom + padding],
                            strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0),
                            strokeWidth: 2.5
                        });
                        gridLayer.addChild(yAxisLine);
                    }

                    if (0 >= viewBounds.top && 0 <= viewBounds.bottom) {
                        const xAxisLine = new paper.Path.Line({
                            from: [viewBounds.left - padding, 0],
                            to: [viewBounds.right + padding, 0],
                            strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0),
                            strokeWidth: 2.5
                        });
                        gridLayer.addChild(xAxisLine);
                    }
                }

                // 创建网格线（如果启用）
                if (showGrid) {
                    for (let x = minX; x <= maxX; x += gridSize) {
                        if (showAxis && x === 0) continue;
                        
                        const gridIndex = Math.round(x / gridSize);
                        const isMainGrid = gridIndex % 5 === 0;

                        const line = new paper.Path.Line({
                            from: [x, minY],
                            to: [x, maxY],
                            strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                            strokeWidth: isMainGrid ? 0.8 : 0.3
                        });
                        gridLayer.addChild(line);
                    }

                    for (let y = minY; y <= maxY; y += gridSize) {
                        if (showAxis && y === 0) continue;
                        
                        const gridIndex = Math.round(y / gridSize);
                        const isMainGrid = gridIndex % 5 === 0;

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
        }
    }, [zoom, panX, panY]);

    return (
        <div className="flex-1 relative overflow-hidden">
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                style={{ background: 'white' }}
            />
        </div>
    );
};

export default Canvas;