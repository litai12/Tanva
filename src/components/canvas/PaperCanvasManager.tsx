import { useEffect } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';

interface PaperCanvasManagerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onInitialized?: () => void;
}

const PaperCanvasManager: React.FC<PaperCanvasManagerProps> = ({ 
  canvasRef, 
  onInitialized 
}) => {
  const { zoom, panX, panY, setPan } = useCanvasStore();

  // Paper.js 初始化和画布尺寸管理
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 初始化Paper.js
    paper.setup(canvas);
    
    // 禁用Paper.js的默认交互行为
    if (paper.view) {
      paper.view.onMouseDown = null;
      paper.view.onMouseDrag = null;
      paper.view.onMouseUp = null;
    }

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
          
          // 通知外部组件初始化完成
          if (onInitialized) {
            onInitialized();
          }
        } else {
          // 应用视口变换
          applyViewTransform();
        }
      }
    };

    // 应用视口变换 - 使用Paper.js默认左上角坐标系
    const applyViewTransform = () => {
      // 构建新的变换矩阵，避免频繁重置
      const matrix = new paper.Matrix();
      matrix.scale(zoom);
      matrix.translate(panX, panY);
      paper.view.matrix = matrix;
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
    };
  }, [canvasRef, setPan, onInitialized]);

  // 处理视口变换的effect
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // 应用视口变换
    const matrix = new paper.Matrix();
    matrix.scale(zoom);
    matrix.translate(panX, panY);
    paper.view.matrix = matrix;
    
  }, [zoom, panX, panY, canvasRef]);

  return null; // 这个组件不渲染任何DOM
};

export default PaperCanvasManager;