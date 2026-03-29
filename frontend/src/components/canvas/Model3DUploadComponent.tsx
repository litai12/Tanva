import { logger } from '@/utils/logger';
import React, { useRef, useCallback } from 'react';
import { model3DUploadService } from '@/services/model3DUploadService';
import type { Model3DData } from '@/services/model3DUploadService';
import { useTranslation } from 'react-i18next';

interface Model3DUploadComponentProps {
  onModel3DUploaded: (modelData: Model3DData) => void;
  onUploadError: (error: string) => void;
  trigger: boolean; // External trigger signal.
  onTriggerHandled: () => void; // Callback after trigger handling.
  projectId?: string | null;
}

const Model3DUploadComponent: React.FC<Model3DUploadComponentProps> = ({
  onModel3DUploaded,
  onUploadError,
  trigger,
  onTriggerHandled,
  projectId,
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection.
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      logger.debug('Starting 3D model processing:', file.name);

      const uploadDir = projectId ? `projects/${projectId}/models/` : 'uploads/models/';
      const result = await model3DUploadService.uploadModelFile(file, {
        projectId,
        dir: uploadDir,
        fileName: file.name,
      });

      if (result.success && result.asset) {
        const modelData = model3DUploadService.createModel3DData(result.asset);
        logger.debug('3D model uploaded:', modelData.fileName);
        onModel3DUploaded(modelData);
      } else {
        console.error('3D model processing failed:', result.error);
        onUploadError(result.error || lt('3D模型处理失败', '3D model processing failed'));
      }
    } catch (error) {
      console.error('3D model processing exception:', error);
      onUploadError(lt('3D模型处理失败，请重试', '3D model processing failed. Please try again.'));
    }

    // Clear input value to allow selecting the same file again.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [lt, onModel3DUploaded, onUploadError]);

  // Handle external trigger.
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
