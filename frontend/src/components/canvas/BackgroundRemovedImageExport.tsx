import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DownloadIcon, CopyIcon, CheckIcon, AlertCircle } from 'lucide-react';
import paper from 'paper';
import PaperBackgroundRemovalService from '@/services/paperBackgroundRemovalService';
import { logger } from '@/utils/logger';
import { useTranslation } from 'react-i18next';

export interface BackgroundRemovedImageExportProps {
  onExportComplete?: () => void;
}

 

/**
 * 背景移除图像导出组件
 * 支持导出、下载、复制等操作
 */
export const BackgroundRemovedImageExport: React.FC<
  BackgroundRemovedImageExportProps
> = ({ onExportComplete: _onExportComplete }) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '')
    .toLowerCase()
    .startsWith('zh');
  const lt = (zh: string, en: string) => (isZh ? zh : en);
  const [removedImages, setRemovedImages] = useState<paper.Raster[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<boolean | null>(null);

  // 刷新已移除背景的图像列表
  const refreshRemovedImages = () => {
    try {
      const images =
        PaperBackgroundRemovalService.getAllRemovedBGRasters();
      setRemovedImages(images);
      logger.info(`📊 Found ${images.length} removed-background images`);
    } catch (error) {
      logger.error('Failed to refresh images:', error);
    }
  };

  // 选择图像
  const selectImage = (index: number) => {
    setSelectedImageIndex(index);
    if (removedImages[index]) {
      removedImages[index].selected = true;
    }
  };

  // 下载当前选中的图像为PNG
  const handleDownload = async () => {
    if (selectedImageIndex === null) return;

    try {
      setIsExporting(true);
      setExportSuccess(null);

      const image = removedImages[selectedImageIndex];
      const fileName = `${image.name || 'background-removed'}.png`;

      await PaperBackgroundRemovalService.downloadRasterAsPNG(
        image,
        fileName
      );

      setExportSuccess(true);
      logger.info(`✅ Downloaded: ${fileName}`);

      setTimeout(() => setExportSuccess(null), 3000);
    } catch (error) {
      logger.error('Download failed:', error);
      setExportSuccess(false);

      setTimeout(() => setExportSuccess(null), 3000);
    } finally {
      setIsExporting(false);
    }
  };

  // 复制图像为PNG到剪贴板
  const handleCopyToClipboard = async () => {
    if (selectedImageIndex === null) return;

    try {
      setIsExporting(true);
      setExportSuccess(null);

      const image = removedImages[selectedImageIndex];
      const blob = await PaperBackgroundRemovalService.exportRasterAsPNG(
        image
      );

      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob,
        }),
      ]);

      setExportSuccess(true);
      logger.info('✅ Image copied to clipboard');

      setTimeout(() => setExportSuccess(null), 3000);
    } catch (error) {
      logger.error('Copy to clipboard failed:', error);
      setExportSuccess(false);

      setTimeout(() => setExportSuccess(null), 3000);
    } finally {
      setIsExporting(false);
    }
  };

  // 删除选中的图像
  const handleDelete = () => {
    if (selectedImageIndex === null) return;

    try {
      const image = removedImages[selectedImageIndex];
      image.remove();

      const newImages = removedImages.filter((_, i) => i !== selectedImageIndex);
      setRemovedImages(newImages);
      setSelectedImageIndex(
        newImages.length > 0
          ? Math.min(selectedImageIndex, newImages.length - 1)
          : null
      );

      logger.info('🗑️ Image removed');
    } catch (error) {
      logger.error('Delete failed:', error);
    }
  };

  return (
    <Card className="w-full max-w-sm p-4 bg-white shadow-lg border-0 space-y-4">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{lt('已移除背景图像', 'Background Removed Images')}</h3>
        <Button
          onClick={refreshRemovedImages}
          size="sm"
          variant="outline"
          className="text-xs"
        >
          {lt('刷新', 'Refresh')}
        </Button>
      </div>

      {/* 图像列表 */}
      {removedImages.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs text-gray-600 mb-2">
            {lt(`${removedImages.length} 个图像`, `${removedImages.length} images`)}
          </div>

          {/* 图像选择 */}
          <div className="flex flex-wrap gap-2">
            {removedImages.map((image, index) => (
              <button
                key={index}
                onClick={() => selectImage(index)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  selectedImageIndex === index
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {image.name || lt(`图像${index + 1}`, `Image ${index + 1}`)}
              </button>
            ))}
          </div>

          {/* 导出结果信息 */}
          {exportSuccess !== null && (
            <div
              className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                exportSuccess
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {exportSuccess ? (
                <CheckIcon className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              <span>
                {exportSuccess ? lt('✅ 操作成功', '✅ Operation succeeded') : lt('❌ 操作失败', '❌ Operation failed')}
              </span>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleDownload}
              disabled={selectedImageIndex === null || isExporting}
              size="sm"
              className="flex-1 bg-gray-800 hover:bg-gray-900"
            >
              <DownloadIcon className="w-4 h-4 mr-1" />
              {lt('下载PNG', 'Download PNG')}
            </Button>

            <Button
              onClick={handleCopyToClipboard}
              disabled={selectedImageIndex === null || isExporting}
              size="sm"
              variant="outline"
              className="flex-1"
            >
              <CopyIcon className="w-4 h-4 mr-1" />
              {lt('复制', 'Copy')}
            </Button>

            <Button
              onClick={handleDelete}
              disabled={selectedImageIndex === null}
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700"
            >
              {lt('删除', 'Delete')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500">
            {lt('还没有移除背景的图像', 'No background-removed images yet')}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {lt('使用抠图工具后，图像会显示在这里', 'Use the background removal tool and images will appear here')}
          </p>
        </div>
      )}
    </Card>
  );
};

export default BackgroundRemovedImageExport;
