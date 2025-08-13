import React, { useRef, useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore } from '@/stores';

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { 
        gridSize 
    } = useCanvasStore();
    const { showGrid, showAxis } = useUIStore();

    useEffect(() => {
        if (!canvasRef.current) return;

        // 初始化Paper.js
        paper.setup(canvasRef.current);

        
        // 设置画布大小
        const canvas = canvasRef.current;
        const resizeCanvas = () => {
            const parent = canvas.parentElement;
            if (parent) {
                canvas.width = parent.clientWidth;
                canvas.height = parent.clientHeight;
                paper.view.viewSize.width = canvas.width;
                paper.view.viewSize.height = canvas.height;
                
                // 重新绘制专业版网格
                createGrid(gridSize);
            }
        };

        // 专业版网格系统 - 支持主次网格线
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

            // 获取画布尺寸
            const width = paper.view.size.width;
            const height = paper.view.size.height;

            // 中心坐标系 - 原点在画布中心
            const originX = width / 2;
            const originY = height / 2;

            // 创建坐标轴（如果启用）
            if (showAxis) {
                // Y轴（中心垂直线）
                const yAxisLine = new paper.Path.Line({
                    from: [originX, 0],
                    to: [originX, height],
                    strokeColor: new paper.Color(0.2, 0.4, 0.8, 1.0), // 蓝色Y轴 - 完全不透明
                    strokeWidth: 2.5,
                    data: { isAxis: true, axis: 'Y' }
                });
                yAxisLine.sendToBack();
                gridLayer.addChild(yAxisLine);

                // X轴（中心水平线）
                const xAxisLine = new paper.Path.Line({
                    from: [0, originY],
                    to: [width, originY],
                    strokeColor: new paper.Color(0.8, 0.2, 0.2, 1.0), // 红色X轴 - 完全不透明
                    strokeWidth: 2.5,
                    data: { isAxis: true, axis: 'X' }
                });
                xAxisLine.sendToBack();
                gridLayer.addChild(xAxisLine);
            }

            // 创建网格线（如果启用）
            if (showGrid) {
                // 创建垂直网格线
                // 向右画线
                for (let i = showAxis ? 1 : 0; originX + i * currentGridSize <= width; i++) {
                    const x = originX + i * currentGridSize;
                    const isMainGrid = i % 5 === 0; // 每5条线为主网格线

                    const line = new paper.Path.Line({
                        from: [x, 0],
                        to: [x, height],
                        strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                        strokeWidth: isMainGrid ? 0.8 : 0.3
                    });
                    gridLayer.addChild(line);
                }

                // 向左画线
                for (let i = 1; originX - i * currentGridSize >= 0; i++) {
                    const x = originX - i * currentGridSize;
                    const isMainGrid = i % 5 === 0;

                    const line = new paper.Path.Line({
                        from: [x, 0],
                        to: [x, height],
                        strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                        strokeWidth: isMainGrid ? 0.8 : 0.3
                    });
                    gridLayer.addChild(line);
                }

                // 创建水平网格线
                // 向下画线
                for (let i = showAxis ? 1 : 0; originY + i * currentGridSize <= height; i++) {
                    const y = originY + i * currentGridSize;
                    const isMainGrid = i % 5 === 0;

                    const line = new paper.Path.Line({
                        from: [0, y],
                        to: [width, y],
                        strokeColor: new paper.Color(0, 0, 0, isMainGrid ? 0.18 : 0.15),
                        strokeWidth: isMainGrid ? 0.8 : 0.3
                    });
                    gridLayer.addChild(line);
                }

                // 向上画线
                for (let i = 1; originY - i * currentGridSize >= 0; i++) {
                    const y = originY - i * currentGridSize;
                    const isMainGrid = i % 5 === 0;

                    const line = new paper.Path.Line({
                        from: [0, y],
                        to: [width, y],
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


        return () => {
            window.removeEventListener('resize', handleResize);
            paper.project.clear();
        };
    }, [gridSize, showGrid, showAxis]);

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