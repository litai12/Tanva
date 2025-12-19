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
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        logger.upload("📸 开始处理图片:", file.name);

        const uploadDir = projectId
          ? `projects/${projectId}/images/`
          : "uploads/images/";
        const result = await imageUploadService.uploadImageFile(file, {
          projectId,
          dir: uploadDir,
          fileName: file.name,
        });

        if (result.success && result.asset) {
          logger.upload("✅ 图片上传成功");
          onImageUploaded({
            ...result.asset,
            src: result.asset.url,
          });
        } else {
          // 🔥 关键修复：不再使用 base64 本地副本作为 fallback，必须上传到 OSS 才能上画板
          const msg = result.error || "图片上传失败，请稍后重试";
          console.error("❌ 图片上传失败:", msg);
          onUploadError(msg);
        }
      } catch (error) {
        console.error("❌ 图片处理异常:", error);
        onUploadError("图片上传失败，请稍后重试");
      } finally {
        // 清空input值，允许重复选择同一文件
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [onImageUploaded, onUploadError, projectId]
  );

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
