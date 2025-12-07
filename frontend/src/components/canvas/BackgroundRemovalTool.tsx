import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import backgroundRemovalService from '@/services/backgroundRemovalService';
import { logger } from '@/utils/logger';
import { ImageIcon, Wand2Icon, XIcon } from 'lucide-react';

export interface BackgroundRemovalToolProps {
  onRemoveComplete?: (imageData: string) => void;
  onCancel?: () => void;
}

/**
 * 背景移除工具组件
 * 提供简洁的UI用于选择图片和移除背景
 */
export const BackgroundRemovalTool: React.FC<BackgroundRemovalToolProps> = ({
  onRemoveComplete,
  onCancel,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingMethod, setProcessingMethod] = useState<
    'frontend' | 'backend' | null
  >(null);
  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      logger.info(`📁 File selected: ${file.name} (${file.size} bytes)`);

      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        throw new Error('Please select a valid image file');
      }

      // 验证文件大小 (最大100MB)
      if (file.size > 100 * 1024 * 1024) {
        throw new Error('File size too large (max 100MB)');
      }

      // 转换为base64
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setSelectedImage(result);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error reading file';
      logger.error('File selection error:', message);
      setError(message);
    }
  };

  const handleRemoveBackground = async () => {
    if (!selectedImage) return;

    try {
      setProcessing(true);
      setError(null);
      setProcessingTime(null);
      logger.info('🎯 Starting background removal...');

      const result = await backgroundRemovalService.removeBackground(
        selectedImage,
        'image/png',
        true // 优先尝试前端处理
      );

      if (result.success && result.imageData) {
        logger.info(
          `✅ Background removal succeeded using ${result.method} (${result.processingTime}ms)`
        );
        setProcessingMethod(result.method || null);
        setProcessingTime(result.processingTime || null);
        onRemoveComplete?.(result.imageData);
      } else {
        throw new Error(result.error || 'Background removal failed');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Background removal failed';
      logger.error('Background removal error:', message);
      setError(message);
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setSelectedImage(null);
    setError(null);
    setProcessingTime(null);
    setProcessingMethod(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[2000] pointer-events-none bg-black bg-opacity-40 backdrop-blur-sm">
      <Card className="w-11/12 max-w-4xl p-10 bg-white shadow-2xl border-0 rounded-3xl pointer-events-auto">
        <div className="space-y-5">
          {/* 标题 */}
          <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Wand2Icon className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-gray-900">Background Removal</h2>
              <p className="text-sm text-gray-500">Remove background from your images instantly</p>
            </div>
          </div>

          {/* 图片预览或选择区域 */}
          {!selectedImage ? (
            <div className="border-2 border-dashed border-blue-200 rounded-2xl p-16 text-center bg-gradient-to-br from-blue-50 to-transparent">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <div className="p-4 bg-blue-100 rounded-full">
                  <ImageIcon className="w-10 h-10 text-blue-600" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-800">
                    点击上传图片
                  </p>
                  <p className="text-sm text-gray-500 mt-1">PNG, JPG, GIF, WebP up to 100MB</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative group">
              <img
                src={selectedImage}
                alt="Selected"
                className="w-full max-h-96 object-cover rounded-2xl border-2 border-gray-100 shadow-md group-hover:shadow-lg transition-shadow"
              />
            {processing && (
              <div className="absolute inset-0 bg-black bg-opacity-40 rounded-lg flex items-center justify-center">
                <LoadingSpinner />
              </div>
            )}
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-5 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 rounded-lg flex-shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-red-700 flex-grow">{error}</p>
            </div>
          </div>
        )}

        {/* 处理信息 */}
        {processingTime !== null && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-5 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg flex-shrink-0">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-grow">
                <p className="text-sm font-semibold text-green-700">
                  Successfully removed background!
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Processed using{' '}
                  <span className="font-bold">
                    {processingMethod === 'frontend' ? 'Frontend' : 'Backend'}
                  </span>{' '}
                  in {processingTime}ms
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-2">
          {selectedImage && !processing && (
            <>
              <Button
                onClick={handleRemoveBackground}
                disabled={processing}
                className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-base font-semibold py-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
              >
                <Wand2Icon className="w-5 h-5 mr-2" />
                Remove Background
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                className="flex-1 text-base font-semibold py-6 rounded-xl border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all duration-200"
              >
                Reset
              </Button>
            </>
          )}

          {!selectedImage && (
            <>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={processing}
                className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-base font-semibold py-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
              >
                <ImageIcon className="w-5 h-5 mr-2" />
                点击上传图片
              </Button>
              {onCancel && (
                <Button onClick={onCancel} variant="outline" className="px-6 py-6 rounded-xl border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all duration-200">
                  <XIcon className="w-5 h-5 text-gray-600" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
    </div>
  );
};

export default BackgroundRemovalTool;
