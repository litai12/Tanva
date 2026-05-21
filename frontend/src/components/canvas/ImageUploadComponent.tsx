// Canvas image upload trigger with local preview and OSS sync.
import { logger } from '@/utils/logger';
import React, { useRef, useCallback } from 'react';
import { imageUploadService } from '@/services/imageUploadService';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import type { StoredImageAsset } from '@/types/canvas';
import { generateOssKey } from '@/services/ossUploadService';
import { useTranslation } from 'react-i18next';

interface ImageUploadComponentProps {
  onImageUploaded: (asset: StoredImageAsset) => void;
  onUploadError: (error: string) => void;
  trigger: boolean; // External trigger signal.
  onTriggerHandled: () => void; // Callback after trigger handling.
  projectId?: string | null;
}

const ImageUploadComponent: React.FC<ImageUploadComponentProps> = ({
  onImageUploaded,
  onUploadError,
  trigger,
  onTriggerHandled,
  projectId,
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

      // 1) Put a local preview on canvas immediately.
      // Convert to data URL so pickRasterSource recognises it as an inline preview
      // (isInlineDataUrl checks for "data:image" prefix; blob: URLs are rejected).
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const imageId = `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { key } = generateOssKey({
        projectId,
        dir: uploadDir,
        fileName: file.name,
        contentType: file.type,
      });
      const localAsset: StoredImageAsset = {
        id: imageId,
        url: key, // Link key first so the asset can be persisted.
        key,
        src: dataUrl,
        fileName: file.name,
        contentType: file.type,
        pendingUpload: true,
        localDataUrl: dataUrl,
      };
      onImageUploaded(localAsset);

      // 2) Upload in background, then upgrade source and clean local blob.
      const result = await imageUploadService.uploadImageFile(file, {
        projectId,
        dir: uploadDir,
        fileName: file.name,
        key,
      });

      if (result.success && result.asset?.url) {
        logger.upload('Image uploaded and upgraded to remote source.');
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
        void recordImageHistoryEntry({
          remoteUrl: result.asset.url,
          title: file.name,
          fileName: file.name,
          nodeId: 'canvas',
          nodeType: 'image',
          projectId,
          skipInitialStoreUpdate: true,
        });
      } else {
        console.error('Image upload failed, local fallback kept:', result.error);
        onUploadError(
          result.error ||
            lt(
              '图片上传失败，已保留本地副本（可稍后重试上传）',
              'Image upload failed; local copy is kept (you can retry later).'
            )
        );
      }
    } catch (error) {
      console.error('Image processing exception:', error);
      if (file) {
        try {
          // Fallback: show a local data URL preview so pickRasterSource can use it.
          const fallbackDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          const imageId = `local_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const fallbackAsset: StoredImageAsset = {
            id: imageId,
            url: fallbackDataUrl,
            src: fallbackDataUrl,
            fileName: file.name,
            pendingUpload: true,
            localDataUrl: fallbackDataUrl,
            contentType: file.type,
          };
          onImageUploaded(fallbackAsset);
          onUploadError(
            lt(
              '图片上传失败，已保留本地副本（可稍后重试上传）',
              'Image upload failed; local copy is kept (you can retry later).'
            )
          );
        } catch (fallbackError) {
          console.error('Local fallback failed:', fallbackError);
          onUploadError(lt('图片处理失败，请重试', 'Image processing failed. Please try again.'));
        }
      }
    } finally {
      // Clear input value to allow selecting the same file again.
      resetInputValue();
    }
  }, [lt, onImageUploaded, onUploadError, projectId, resetInputValue]);

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
