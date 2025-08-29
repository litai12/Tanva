import { logger } from '@/utils/logger';
import React, { useRef, useCallback } from 'react';
import { model3DUploadService } from '@/services/model3DUploadService';
import type { Model3DData } from '@/services/model3DUploadService';

interface Model3DUploadComponentProps {
  onModel3DUploaded: (modelData: Model3DData) => void;
  onUploadError: (error: string) => void;
  trigger: boolean; // 外部控制触发上传
  onTriggerHandled: () => void; // 触发处理完成的回调
}

const Model3DUploadComponent: React.FC<Model3DUploadComponentProps> = ({
  onModel3DUploaded,
  onUploadError,
  trigger,
  onTriggerHandled,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理文件选择
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      logger.debug('🎲 开始处理3D模型文件:', file.name);
      
      // 处理3D模型文件
      const result = await model3DUploadService.processModel3DFile(file);

      if (result.success) {
        const modelData = model3DUploadService.createModel3DData(result);
        if (modelData) {
          logger.debug('✅ 3D模型处理成功:', modelData.fileName);
          onModel3DUploaded(modelData);
        } else {
          console.error('❌ 3D模型数据创建失败');
          onUploadError('3D模型数据创建失败');
        }
      } else {
        console.error('❌ 3D模型处理失败:', result.error);
        onUploadError(result.error || '3D模型处理失败');
      }
    } catch (error) {
      console.error('❌ 3D模型处理异常:', error);
      onUploadError('3D模型处理失败，请重试');
    }

    // 清空input值，允许重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onModel3DUploaded, onUploadError]);

  // 处理外部触发
  React.useEffect(() => {
    if (trigger && fileInputRef.current) {
      fileInputRef.current.click();
      onTriggerHandled();
    }
  }, [trigger, onTriggerHandled]);

  return (
    <input
      ref={fileInputRef}
      type="file"
      accept=".glb,.gltf"
      style={{ display: 'none' }}
      onChange={handleFileSelect}
    />
  );
};

export default Model3DUploadComponent;