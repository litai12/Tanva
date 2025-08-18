import React from 'react';
import { Button } from '@/components/ui/button';
import { Eraser, Trash2 } from 'lucide-react';

interface UtilityToolGroupProps {
  isEraser: boolean;
  onToggleEraser: () => void;
  onClearCanvas?: () => void;
}

const UtilityToolGroup: React.FC<UtilityToolGroupProps> = ({ 
  isEraser,
  onToggleEraser,
  onClearCanvas
}) => {
  const handleClearCanvas = () => {
    if (window.confirm('确定要清空画布吗？此操作将删除所有图元，不可撤销。')) {
      onClearCanvas?.();
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {/* 橡皮擦工具 */}
      <Button
        onClick={onToggleEraser}
        variant={isEraser ? "default" : "outline"}
        size="sm"
        className="px-2 py-2 h-8 w-8"
        title={isEraser ? "切换到画笔" : "切换到橡皮擦"}
      >
        <Eraser className="w-4 h-4" />
      </Button>

      {/* 清理画布按钮 */}
      {onClearCanvas && (
        <Button
          onClick={handleClearCanvas}
          variant="outline"
          size="sm"
          className="px-2 py-2 h-8 w-8 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
          title="清空画布 (清除所有图元)"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
};

export default UtilityToolGroup;