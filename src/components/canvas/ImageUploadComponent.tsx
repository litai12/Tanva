import React, { useRef, useCallback } from 'react';
import { imageUploadService } from '@/services/imageUploadService';

interface ImageUploadComponentProps {
  onImageUploaded: (imageData: string) => void;
  onUploadError: (error: string) => void;
  trigger: boolean; // 外部控制触发上传
  onTriggerHandled: () => void; // 触发处理完成的回调
}

const ImageUploadComponent: React.FC<ImageUploadComponentProps> = ({
  onImageUploaded,
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
      console.log('📸 开始处理图片:', file.name);
      
      // 处理图片
      const result = await imageUploadService.processImageFile(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.8
      });

      if (result.success && result.data) {
        console.log('✅ 图片处理成功');
        onImageUploaded(result.data);
      } else {
        console.error('❌ 图片处理失败:', result.error);
        onUploadError(result.error || '图片处理失败');
      }
    } catch (error) {
      console.error('❌ 图片处理异常:', error);
      onUploadError('图片处理失败，请重试');
    }

    // 清空input值，允许重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onImageUploaded, onUploadError]);

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
      accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
      style={{ display: 'none' }}
      onChange={handleFileSelect}
    />
  );
};

export default ImageUploadComponent;