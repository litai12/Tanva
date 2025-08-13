import React, { useRef, useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore, useUIStore } from '@/stores';

const Canvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { currentColor, strokeWidth, setGeometryData } = useCanvasStore();
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
                
                // 重新绘制网格和坐标轴
                drawGrid();
                drawAxis();
            }
        };

        // 绘制网格
        const drawGrid = () => {
            // 清除现有网格
            const existingGrid = paper.project.layers.find(layer => layer.name === 'grid');
            if (existingGrid) {
                existingGrid.remove();
            }

            if (!showGrid) return;

            const gridLayer = new paper.Layer();
            gridLayer.name = 'grid';

            const gridSize = 20;
            const viewBounds = paper.view.bounds;

            // 绘制垂直线
            for (let x = 0; x <= viewBounds.width; x += gridSize) {
                const line = new paper.Path.Line(
                    new paper.Point(x, 0),
                    new paper.Point(x, viewBounds.height)
                );
                line.strokeColor = new paper.Color(0.9, 0.9, 0.9);
                line.strokeWidth = 0.5;
            }

            // 绘制水平线
            for (let y = 0; y <= viewBounds.height; y += gridSize) {
                const line = new paper.Path.Line(
                    new paper.Point(0, y),
                    new paper.Point(viewBounds.width, y)
                );
                line.strokeColor = new paper.Color(0.9, 0.9, 0.9);
                line.strokeWidth = 0.5;
            }

            gridLayer.sendToBack();
        };

        // 绘制坐标轴
        const drawAxis = () => {
            // 清除现有坐标轴
            const existingAxis = paper.project.layers.find(layer => layer.name === 'axis');
            if (existingAxis) {
                existingAxis.remove();
            }

            if (!showAxis) return;

            const axisLayer = new paper.Layer();
            axisLayer.name = 'axis';

            const viewBounds = paper.view.bounds;
            const centerX = viewBounds.width / 2;
            const centerY = viewBounds.height / 2;

            // X轴
            const xAxis = new paper.Path.Line(
                new paper.Point(0, centerY),
                new paper.Point(viewBounds.width, centerY)
            );
            xAxis.strokeColor = new paper.Color(0.5, 0.5, 0.5);
            xAxis.strokeWidth = 1;

            // Y轴
            const yAxis = new paper.Path.Line(
                new paper.Point(centerX, 0),
                new paper.Point(centerX, viewBounds.height)
            );
            yAxis.strokeColor = new paper.Color(0.5, 0.5, 0.5);
            yAxis.strokeWidth = 1;

            axisLayer.sendToBack();
        };

        // 初始化画布
        resizeCanvas();

        // 监听窗口大小变化
        const handleResize = () => {
            setTimeout(resizeCanvas, 100);
        };
        window.addEventListener('resize', handleResize);

        // 基础绘图功能
        let currentPath: paper.Path | null = null;

        const tool = new paper.Tool();

        tool.onMouseDown = (event: paper.ToolEvent) => {
            currentPath = new paper.Path();
            currentPath.strokeColor = new paper.Color(currentColor);
            currentPath.strokeWidth = strokeWidth;
            currentPath.add(event.point);
        };

        tool.onMouseDrag = (event: paper.ToolEvent) => {
            if (currentPath) {
                currentPath.add(event.point);
            }
        };

        tool.onMouseUp = () => {
            if (currentPath) {
                currentPath.simplify();
                // 更新几何数据
                setGeometryData({
                    elements: paper.project.activeLayer.children.length,
                    timestamp: Date.now()
                });
            }
        };

        return () => {
            window.removeEventListener('resize', handleResize);
            paper.project.clear();
        };
    }, [currentColor, strokeWidth, showGrid, showAxis, setGeometryData]);

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