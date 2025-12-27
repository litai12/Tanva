import React from 'react';
import { X, Download, Trash2, Calendar, Folder, Tag } from 'lucide-react';
import { Button } from '../ui/button';
import type { GlobalImageHistoryItem } from '@/services/globalImageHistoryApi';

const SOURCE_TYPE_LABELS: Record<string, string> = {
  generate: '图片生成',
  generatePro: '图片生成Pro',
  generatePro4: '图片生成Pro4',
  midjourney: 'Midjourney',
  '3d': '3D生成',
  camera: '相机',
  image: '图片',
  imagePro: '图片Pro',
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
  const formattedDate = new Date(item.createdAt).toLocaleString('zh-CN');
  const typeLabel = SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType;

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
          <h3 className="text-white font-medium">图片详情</h3>
          <div className="flex items-center gap-2">
            <Button
              onClick={onDownload}
              variant="outline"
              size="sm"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            >
              <Download className="h-4 w-4 mr-1" />
              下载
            </Button>
            <Button
              onClick={onDelete}
              variant="outline"
              size="sm"
              className="bg-red-500/10 text-red-300 border-red-400/30 hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              删除
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
          {/* 图片预览 */}
          <div className="flex-1 flex items-center justify-center bg-black/50 rounded-lg">
            <img
              src={item.imageUrl}
              alt={item.prompt || '图片'}
              className="max-w-full max-h-[60vh] object-contain"
            />
          </div>

          {/* 信息面板 */}
          <div className="w-72 space-y-4">
            <InfoItem
              icon={<Calendar className="h-4 w-4" />}
              label="生成时间"
              value={formattedDate}
            />
            <InfoItem
              icon={<Tag className="h-4 w-4" />}
              label="类型"
              value={typeLabel}
            />
            {item.sourceProjectName && (
              <InfoItem
                icon={<Folder className="h-4 w-4" />}
                label="来源项目"
                value={item.sourceProjectName}
              />
            )}
            {item.prompt && (
              <div className="space-y-1">
                <p className="text-gray-400 text-xs">Prompt</p>
                <p className="text-white text-sm bg-white/5 rounded-lg p-3 break-words">
                  {item.prompt}
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
