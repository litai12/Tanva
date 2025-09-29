import { logger } from '@/utils/logger';
import React, { useRef, useCallback } from 'react';
import { imageUploadService } from '@/services/imageUploadService';
import { ossUploadService } from '@/services/ossUploadService';
import type { StoredImageAsset } from '@/types/canvas';

interface ImageUploadComponentProps {
  onImageUploaded: (asset: StoredImageAsset) => void;
  onUploadError: (error: string) => void;
  trigger: boolean; // 外部控制触发上传
  onTriggerHandled: () => void; // 触发处理完成的回调
  projectId?: string | null;
}

const ImageUploadComponent: React.FC<ImageUploadComponentProps> = ({
  onImageUploaded,
  onUploadError,
  trigger,
  onTriggerHandled,
  projectId,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理文件选择
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      logger.upload('📸 开始处理图片:', file.name);

      const uploadDir = projectId ? `projects/${projectId}/images/` : 'uploads/images/';
      const result = await imageUploadService.uploadImageFile(file, {
        projectId,
        dir: uploadDir,
        fileName: file.name,
      });

      if (result.success && result.asset) {
        logger.upload('✅ 图片上传成功');
        onImageUploaded({
          ...result.asset,
          src: result.asset.url,
        });
      } else {
        // fallback to local data URL
        const [dataUrl, dims] = await Promise.all([
          ossUploadService.fileToDataURL(file),
          ossUploadService.getImageDimensions(file),
        ]);
        const fallbackAsset: StoredImageAsset = {
          id: `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          url: dataUrl,
          src: dataUrl,
          fileName: file.name,
          width: dims.width,
          height: dims.height,
          pendingUpload: true,
          localDataUrl: dataUrl,
        };
        onImageUploaded(fallbackAsset);
        console.error('❌ 图片上传失败，已使用本地副本:', result.error);
        onUploadError(result.error || '图片上传失败，已使用本地副本');
      }
    } catch (error) {
      console.error('❌ 图片处理异常:', error);
      if (file) {
        try {
          const [dataUrl, dims] = await Promise.all([
            ossUploadService.fileToDataURL(file),
            ossUploadService.getImageDimensions(file),
          ]);
          const fallbackAsset: StoredImageAsset = {
            id: `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            url: dataUrl,
            src: dataUrl,
            fileName: file.name,
            pendingUpload: true,
            localDataUrl: dataUrl,
            width: dims.width,
            height: dims.height,
          };
          onImageUploaded(fallbackAsset);
          onUploadError('图片上传失败，已使用本地副本');
        } catch (fallbackError) {
          console.error('❌ 本地兜底失败:', fallbackError);
          onUploadError('图片处理失败，请重试');
        }
      }
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
