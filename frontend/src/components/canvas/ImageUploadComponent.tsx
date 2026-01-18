import { logger } from '@/utils/logger';
import React, { useRef, useCallback } from 'react';
import { imageUploadService } from '@/services/imageUploadService';
import type { StoredImageAsset } from '@/types/canvas';
import { generateOssKey } from '@/services/ossUploadService';

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

      // 1) 先用 blob: 立即上画布，避免“等待上传完成才显示”
      const blobUrl = URL.createObjectURL(file);
      const imageId = `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { key } = generateOssKey({
        projectId,
        dir: uploadDir,
        fileName: file.name,
        contentType: file.type,
      });
      const localAsset: StoredImageAsset = {
        id: imageId,
        url: key, // 先关联 key，确保可持久化引用
        key,
        src: key,
        fileName: file.name,
        contentType: file.type,
        pendingUpload: true,
        localDataUrl: blobUrl,
      };
      onImageUploaded(localAsset);

      // 2) 后台上传：成功后回写并清理本地临时 blob
      const result = await imageUploadService.uploadImageFile(file, {
        projectId,
        dir: uploadDir,
        fileName: file.name,
        key,
      });

      if (result.success && result.asset?.url) {
        logger.upload('✅ 图片上传成功（已回写远程元数据）');
        try {
          window.dispatchEvent(
            new CustomEvent('tanva:upgradeImageSource', {
              detail: {
                placeholderId: imageId,
                key: result.asset.key || key,
                remoteUrl: result.asset.url,
              },
            }),
          );
        } catch {}
        return;
      }

      console.error('❌ 图片上传失败，已保留本地副本:', result.error);
      onUploadError(result.error || '图片上传失败，已保留本地副本（可稍后重试上传）');
    } catch (error) {
      console.error('❌ 图片处理异常:', error);
      if (file) {
        try {
          // 兜底：至少保证本地可见（blob:），并标记为待上传
          const blobUrl = URL.createObjectURL(file);
          const imageId = `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const fallbackAsset: StoredImageAsset = {
            id: imageId,
            url: blobUrl,
            src: blobUrl,
            fileName: file.name,
            pendingUpload: true,
            localDataUrl: blobUrl,
            contentType: file.type,
          };
          onImageUploaded(fallbackAsset);
          onUploadError('图片上传失败，已保留本地副本（可稍后重试上传）');
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
