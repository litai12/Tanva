import React, { useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Trash2, Search, Filter, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import SmartImage from '../ui/SmartImage';
import { useGlobalImageHistoryStore } from '@/stores/globalImageHistoryStore';
import type { GlobalImageHistoryItem } from '@/services/globalImageHistoryApi';
import GlobalImageDetailModal from './GlobalImageDetailModal';

interface GlobalImageHistoryPageProps {
  isOpen: boolean;
  onClose: () => void;
}

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

// Header 子组件
interface HeaderProps {
  onClose: () => void;
  filterType: string;
  setFilterType: (type: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const Header: React.FC<HeaderProps> = ({
  onClose,
  filterType,
  setFilterType,
  searchQuery,
  setSearchQuery,
}) => (
  <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
    <h2 className="text-xl font-semibold text-white">全局图片历史</h2>
    <div className="flex items-center gap-4">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="搜索 prompt 或项目名..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-4 py-2 w-64 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {/* 类型筛选 */}
      <select
        value={filterType}
        onChange={(e) => setFilterType(e.target.value)}
        className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">全部类型</option>
        {Object.entries(SOURCE_TYPE_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      {/* 关闭按钮 */}
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
);

// ImageCard 子组件
interface ImageCardProps {
  item: GlobalImageHistoryItem;
  onSelect: (item: GlobalImageHistoryItem) => void;
  onDelete: (id: string) => void;
  onDownload: (item: GlobalImageHistoryItem) => void;
}

const ImageCard: React.FC<ImageCardProps> = ({
  item,
  onSelect,
  onDelete,
  onDownload,
}) => {
  const formattedDate = new Date(item.createdAt).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
  const typeLabel = SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType;

  return (
    <div
      className="group relative rounded-lg overflow-hidden bg-white/5 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
      onClick={() => onSelect(item)}
    >
      <div className="aspect-square">
        <SmartImage
          src={item.imageUrl}
          alt={item.prompt || '图片'}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      {/* 悬浮操作栏 */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(item); }}
            className="p-1.5 rounded bg-white/20 hover:bg-white/40 text-white"
            title="下载"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
            className="p-1.5 rounded bg-red-500/60 hover:bg-red-500 text-white"
            title="删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="text-white text-xs">
          <p className="truncate">{item.prompt || '无描述'}</p>
        </div>
      </div>
      {/* 底部信息 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pointer-events-none">
        <div className="flex items-center justify-between text-xs text-white/80">
          <span>{formattedDate}</span>
          <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">{typeLabel}</span>
        </div>
      </div>
    </div>
  );
};

// ImageGrid 子组件
interface ImageGridProps {
  items: GlobalImageHistoryItem[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (item: GlobalImageHistoryItem) => void;
  onDelete: (id: string) => void;
  onDownload: (item: GlobalImageHistoryItem) => void;
}

const ImageGrid: React.FC<ImageGridProps> = ({
  items,
  isLoading,
  hasMore,
  onLoadMore,
  onSelect,
  onDelete,
  onDownload,
}) => (
  <div className="flex-1 overflow-y-auto p-6">
    {items.length === 0 && !isLoading ? (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <p className="text-lg">暂无图片历史</p>
        <p className="text-sm mt-2">生成的图片会自动保存到这里</p>
      </div>
    ) : (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {items.map((item) => (
            <ImageCard
              key={item.id}
              item={item}
              onSelect={onSelect}
              onDelete={onDelete}
              onDownload={onDownload}
            />
          ))}
        </div>
        {/* 加载更多 */}
        {hasMore && (
          <div className="flex justify-center mt-6">
            <Button
              onClick={onLoadMore}
              disabled={isLoading}
              variant="outline"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载中...
                </>
              ) : (
                '加载更多'
              )}
            </Button>
          </div>
        )}
      </>
    )}
  </div>
);

export const GlobalImageHistoryPage: React.FC<GlobalImageHistoryPageProps> = ({
  isOpen,
  onClose,
}) => {
  const { items, isLoading, hasMore, fetchItems, deleteItem, reset } =
    useGlobalImageHistoryStore();

  const [selectedItem, setSelectedItem] = useState<GlobalImageHistoryItem | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // 初始加载
  useEffect(() => {
    if (isOpen) {
      reset();
      fetchItems(true);
    }
  }, [isOpen, reset, fetchItems]);

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (selectedItem) {
          setSelectedItem(null);
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, selectedItem]);

  // 加载更多
  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchItems(false);
    }
  }, [isLoading, hasMore, fetchItems]);

  // 删除图片
  const handleDelete = useCallback(async (id: string) => {
    if (window.confirm('确定要删除这张图片吗？')) {
      await deleteItem(id);
      setSelectedItem(null);
    }
  }, [deleteItem]);

  // 下载图片
  const handleDownload = useCallback((item: GlobalImageHistoryItem) => {
    const link = document.createElement('a');
    link.href = item.imageUrl;
    link.download = `image_${item.id}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // 过滤后的列表
  const filteredItems = items.filter((item) => {
    if (filterType && item.sourceType !== filterType) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchPrompt = item.prompt?.toLowerCase().includes(query);
      const matchProject = item.sourceProjectName?.toLowerCase().includes(query);
      if (!matchPrompt && !matchProject) return false;
    }
    return true;
  });

  if (!isOpen) return null;

  const content = (
    <div
      className="fixed inset-0 bg-black/90 backdrop-blur-sm flex flex-col"
      style={{ zIndex: 999998 }}
    >
      {/* 头部 */}
      <Header
        onClose={onClose}
        filterType={filterType}
        setFilterType={setFilterType}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {/* 图片网格 */}
      <ImageGrid
        items={filteredItems}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        onSelect={setSelectedItem}
        onDelete={handleDelete}
        onDownload={handleDownload}
      />

      {/* 详情弹窗 */}
      {selectedItem && (
        <GlobalImageDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onDelete={() => handleDelete(selectedItem.id)}
          onDownload={() => handleDownload(selectedItem)}
        />
      )}
    </div>
  );

  return createPortal(content, document.body);
};

export default GlobalImageHistoryPage;
