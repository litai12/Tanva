import React from 'react';
import { X, Download, Trash2, Calendar, Folder, Tag, Film } from 'lucide-react';
import { Button } from '../ui/button';
import SmartImage from '../ui/SmartImage';
import type { GlobalImageHistoryItem } from '@/services/globalImageHistoryApi';
import { useTranslation } from 'react-i18next';
import {
  getHistoryRequestPrompt,
  getHistoryRequestThumbnail,
} from './historyRequestInfo';
import {
  GLOBAL_HISTORY_SOURCE_TYPE_LABELS,
  getGlobalHistoryMediaUrl,
  getGlobalHistoryVideoThumbnail,
  isGlobalHistoryVideoItem,
} from './historyMedia';

const BANANA_31_MODEL = 'gemini-3.1-flash-image-preview';
const BANANA_PRO_MODEL = 'gemini-3-flash-preview';

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const resolveModelLabel = (
  item: GlobalImageHistoryItem
): { label: string; rawModel?: string } | null => {
  const metadata = item.metadata ?? {};
  const rawModel = pickString(
    metadata.model,
    metadata.resolvedModel,
    metadata.originalModel
  );
  const provider = pickString(metadata.aiProvider, metadata.provider);

  const isNanoBanana2 =
    rawModel?.includes(BANANA_31_MODEL) ||
    provider === 'nano2' ||
    provider === 'banana-3.1';
  if (isNanoBanana2) {
    return { label: 'Nano Banana 2', rawModel };
  }

  const isNanoBananaPro =
    rawModel?.includes(BANANA_PRO_MODEL) ||
    provider === 'banana' ||
    provider === 'gemini-pro';
  if (isNanoBananaPro) {
    return { label: 'Nano Banana Pro', rawModel };
  }

  if (rawModel) {
    return { label: rawModel, rawModel };
  }

  return null;
};

interface GlobalImageDetailModalProps {
  item: GlobalImageHistoryItem;
  onClose: () => void;
  onDelete: () => void;
  onDownload: () => void;
}

const GlobalImageDetailModal: React.FC<GlobalImageDetailModalProps> = ({
  item,
  onClose,
  onDelete,
  onDownload,
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '')
    .toLowerCase()
    .startsWith('zh');
  const lt = (zh: string, en: string) => (isZh ? zh : en);
  const formattedDate = new Date(item.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US');
  const sourceTypeLabel = GLOBAL_HISTORY_SOURCE_TYPE_LABELS[item.sourceType];
  const typeLabel =
    typeof sourceTypeLabel === 'string'
      ? sourceTypeLabel
      : sourceTypeLabel
        ? lt(sourceTypeLabel.zh, sourceTypeLabel.en)
        : item.sourceType;
  const modelInfo = resolveModelLabel(item);
  const requestPrompt = getHistoryRequestPrompt(item);
  const isVideo = isGlobalHistoryVideoItem(item);
  const mediaUrl = getGlobalHistoryMediaUrl(item);
  const videoThumbnail = getGlobalHistoryVideoThumbnail(item);
  const requestThumbnail = isVideo ? undefined : getHistoryRequestThumbnail(item);

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center p-4"
      style={{ zIndex: 999999 }}
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-white font-medium">
            {isVideo ? lt('视频详情', 'Video Details') : lt('图片详情', 'Image Details')}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              onClick={onDownload}
              variant="outline"
              size="sm"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            >
              <Download className="h-4 w-4 mr-1" />
              {lt('下载', 'Download')}
            </Button>
            <Button
              onClick={onDelete}
              variant="outline"
              size="sm"
              className="bg-red-500/10 text-red-300 border-red-400/30 hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {lt('删除', 'Delete')}
            </Button>
            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-white hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-4 flex gap-4">
          {/* 媒体预览 */}
          <div className="flex-1 flex items-center justify-center bg-black/50 rounded-lg">
            {isVideo ? (
              mediaUrl ? (
                <video
                  src={mediaUrl}
                  poster={videoThumbnail}
                  className="max-h-[60vh] max-w-full object-contain"
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <div className="flex h-56 w-full items-center justify-center text-white/55">
                  <Film className="h-10 w-10" />
                </div>
              )
            ) : (
              <SmartImage
                src={mediaUrl}
                alt={item.prompt || lt('图片', 'Image')}
                className="max-w-full max-h-[60vh] object-contain"
              />
            )}
          </div>

          {/* 信息面板 */}
          <div className="w-72 space-y-4">
            <InfoItem
              icon={<Calendar className="h-4 w-4" />}
              label={lt('生成时间', 'Created At')}
              value={formattedDate}
            />
            <InfoItem
              icon={<Tag className="h-4 w-4" />}
              label={lt('类型', 'Type')}
              value={typeLabel}
            />
            {modelInfo && (
              <InfoItem
                icon={<Tag className="h-4 w-4" />}
                label={lt('模型', 'Model')}
                value={modelInfo.label}
              />
            )}
            {modelInfo?.rawModel && modelInfo.rawModel !== modelInfo.label && (
              <InfoItem
                icon={<Tag className="h-4 w-4" />}
                label={lt('模型ID', 'Model ID')}
                value={modelInfo.rawModel}
              />
            )}
            {item.sourceProjectName && (
              <InfoItem
                icon={<Folder className="h-4 w-4" />}
                label={lt('来源项目', 'Source Project')}
                value={item.sourceProjectName}
              />
            )}
            {requestThumbnail && (
              <div className="space-y-2">
                <p className="text-gray-400 text-xs">{lt('请求缩略图', 'Request Thumbnail')}</p>
                <div className="overflow-hidden rounded-lg border border-white/10 bg-white/5">
                  <SmartImage
                    src={requestThumbnail}
                    alt={lt('请求缩略图', 'Request Thumbnail')}
                    className="h-28 w-full object-cover"
                  />
                </div>
              </div>
            )}
            {requestPrompt && (
              <div className="space-y-1">
                <p className="text-gray-400 text-xs">{lt('提示词', 'Prompt')}</p>
                <p className="text-white text-sm bg-white/5 rounded-lg p-3 break-words">
                  {requestPrompt}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// 信息项子组件
const InfoItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div className="flex items-start gap-2">
    <span className="text-gray-400 mt-0.5">{icon}</span>
    <div>
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="text-white text-sm">{value}</p>
    </div>
  </div>
);

export default GlobalImageDetailModal;
