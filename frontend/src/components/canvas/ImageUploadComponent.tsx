// Canvas image upload trigger. Formal assets are created only after OSS upload.
import { logger } from '@/utils/logger';
import React, { useRef, useCallback } from 'react';
import { imageUploadService } from '@/services/imageUploadService';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import type { StoredImageAsset } from '@/types/canvas';
import { useTranslation } from 'react-i18next';

interface ImageUploadComponentProps {
  onImageUploaded: (asset: StoredImageAsset) => void;
  onUploadError: (error: string) => void;
  trigger: boolean; // External trigger signal.
  onTriggerHandled: () => void; // Callback after trigger handling.
  projectId?: string | null;
  target?: 'canvas' | 'node';
  onNodeImageRouteStart?: () => void;
}

const ImageUploadComponent: React.FC<ImageUploadComponentProps> = ({
  onImageUploaded,
  onUploadError,
  trigger,
  onTriggerHandled,
  projectId,
  target = 'canvas',
  onNodeImageRouteStart,
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resetInputValue = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Handle file selection.
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      resetInputValue();
      return;
    }

    try {
      logger.upload('Starting image processing:', file.name);

      const uploadDir = projectId ? `projects/${projectId}/images/` : 'uploads/images/';
      const result = await imageUploadService.uploadImageFile(file, {
        projectId,
        dir: uploadDir,
        fileName: file.name,
      });

      if (!result.success || !result.asset?.url) {
        onUploadError(
          result.error ||
            lt(
              '图片上传失败，未添加到画布',
              'Image upload failed; the asset was not added to the canvas.'
            )
        );
        return;
      }

      if (target === 'node') {
        onNodeImageRouteStart?.();
        window.dispatchEvent(
          new CustomEvent('flow:createImageNode', {
            detail: {
              imageUrl: result.asset.url,
              imageName: result.asset.fileName || file.name,
              label: result.asset.fileName || file.name || 'Image',
            },
          }),
        );
        return;
      }

      const remoteAsset: StoredImageAsset = {
        ...result.asset,
        src: result.asset.url,
        remoteUrl: result.asset.url,
        pendingUpload: false,
      };
      onImageUploaded(remoteAsset);
      logger.upload('Image uploaded before canvas asset creation.');
      void recordImageHistoryEntry({
        remoteUrl: result.asset.url,
        title: result.asset.fileName || file.name,
        fileName: result.asset.fileName || file.name,
        nodeId: 'canvas',
        nodeType: 'image',
        projectId,
        skipInitialStoreUpdate: true,
      });
    } catch (error) {
      console.error('Image processing exception:', error);
      onUploadError(lt('图片上传失败，未添加到画布', 'Image upload failed; the asset was not added to the canvas.'));
    } finally {
      resetInputValue();
    }
  }, [lt, onImageUploaded, onNodeImageRouteStart, onUploadError, projectId, resetInputValue, target]);

  // Handle external trigger.
  React.useEffect(() => {
    if (!trigger) return;

    try {
      resetInputValue();
      if (fileInputRef.current) {
        fileInputRef.current.click();
      } else {
        onUploadError(lt('图片上传组件未就绪，请重试', 'Image upload component is not ready. Please try again.'));
      }
    } catch (error) {
      console.error('Failed to open file picker:', error);
      onUploadError(lt('无法打开文件选择器，请重试', 'Unable to open file picker. Please try again.'));
    } finally {
      onTriggerHandled();
    }
  }, [lt, trigger, onTriggerHandled, onUploadError, resetInputValue]);

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
