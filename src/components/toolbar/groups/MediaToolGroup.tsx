import React from 'react';
import { Button } from '@/components/ui/button';
import { Type, Camera, Image, Box } from 'lucide-react';
import type { DrawMode } from '@/stores';

interface MediaToolGroupProps {
  currentMode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
}

const MediaToolGroup: React.FC<MediaToolGroupProps> = ({ 
  currentMode, 
  onModeChange 
}) => {
  const mediaTools = [
    { mode: 'text' as const, icon: Type, title: '添加文本' },
    { mode: 'image' as const, icon: Image, title: '添加图片' },
    { mode: '3d-model' as const, icon: Box, title: '添加3D模型' },
    { mode: 'screenshot' as const, icon: Camera, title: '截图工具' }
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      {mediaTools.map(({ mode, icon: Icon, title }) => (
        <Button
          key={mode}
          variant={currentMode === mode ? 'default' : 'outline'}
          size="sm"
          className="px-2 py-2 h-8 w-8"
          onClick={() => onModeChange(mode)}
          title={title}
        >
          <Icon className="w-4 h-4" />
        </Button>
      ))}
    </div>
  );
};

export default MediaToolGroup;