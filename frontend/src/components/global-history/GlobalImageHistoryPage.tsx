import React, { useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Trash2, Search, Loader2, Play, Film } from 'lucide-react';
import { Button } from '../ui/button';
import SmartImage from '../ui/SmartImage';
import { useGlobalImageHistoryStore } from '@/stores/globalImageHistoryStore';
import type { GlobalImageHistoryItem } from '@/services/globalImageHistoryApi';
import GlobalImageDetailModal from './GlobalImageDetailModal';
import { useTranslation } from 'react-i18next';
import {
  getHistoryRequestPrompt,
  getHistoryRequestThumbnail,
} from './historyRequestInfo';
import {
  GLOBAL_HISTORY_SOURCE_TYPE_LABELS,
  getGlobalHistoryDownloadFileName,
  getGlobalHistoryMediaUrl,
  getGlobalHistoryVideoThumbnail,
  isGlobalHistoryVideoItem,
} from './historyMedia';

interface GlobalImageHistoryPageProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional image-picker mode used by tools such as the 3D Director. */
  selectionRequest?: { requestId: string; purpose?: string } | null;
  onSelectImage?: (item: GlobalImageHistoryItem) => void;
}

// Header 子组件
interface HeaderProps {
  onClose: () => void;
  filterType: string;
  setFilterType: (type: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  lt: (zh: string, en: string) => string;
}

const Header: React.FC<HeaderProps> = ({
  onClose,
  filterType,
  setFilterType,
  searchQuery,
  setSearchQuery,
  lt,
}) => (
  <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
    <h2 className="text-xl font-semibold text-white">{lt('全局历史', 'Global History')}</h2>
    <div className="flex items-center gap-4">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder={lt('搜索 prompt 或项目名...', 'Search prompt or project...')}
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
        <option value="">{lt('全部类型', 'All Types')}</option>
        {Object.entries(GLOBAL_HISTORY_SOURCE_TYPE_LABELS).map(([key, label]) => (
          <option key={key} value={key}>
            {lt(label.zh, label.en)}
          </option>
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
  lt: (zh: string, en: string) => string;
  isZh: boolean;
  resolveSourceTypeLabel: (sourceType: string) => string;
}

const ImageCard: React.FC<ImageCardProps> = ({
  item,
  onSelect,
  onDelete,
  onDownload,
  lt,
  isZh,
  resolveSourceTypeLabel,
}) => {
  const formattedDate = new Date(item.createdAt).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
  });
  const typeLabel = resolveSourceTypeLabel(item.sourceType);
  const requestPrompt = getHistoryRequestPrompt(item);
  const isVideo = isGlobalHistoryVideoItem(item);
  const mediaUrl = getGlobalHistoryMediaUrl(item);
  const videoThumbnail = getGlobalHistoryVideoThumbnail(item);
  const requestThumbnail = isVideo ? undefined : getHistoryRequestThumbnail(item);
  const mediaLabel = isVideo ? lt('视频', 'Video') : lt('图片', 'Image');

  return (
    <div
      className="group relative rounded-lg overflow-hidden bg-white/5 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
      onClick={() => onSelect(item)}
    >
      <div className="relative aspect-square bg-black/50">
        {isVideo ? (
          videoThumbnail ? (
            <SmartImage
              src={videoThumbnail}
              alt={requestPrompt || mediaLabel}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : mediaUrl ? (
            <video
              src={mediaUrl}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/55">
              <Film className="h-8 w-8" />
            </div>
          )
        ) : (
          <SmartImage
            src={mediaUrl}
            alt={requestPrompt || mediaLabel}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
        {isVideo ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow-lg">
              <Play className="h-5 w-5 fill-current" />
            </div>
          </div>
        ) : null}
      </div>
      {requestThumbnail ? (
        <div className="absolute left-2 top-2 rounded-lg border border-white/15 bg-black/55 p-1 backdrop-blur-sm">
          <div className="text-[10px] leading-none text-white/70">
            {lt('请求图', 'Req')}
          </div>
          <SmartImage
            src={requestThumbnail}
            alt={lt('请求缩略图', 'Request Thumbnail')}
            className="mt-1 h-12 w-12 rounded object-cover"
            loading="lazy"
          />
        </div>
      ) : null}
      {/* 悬浮操作栏 */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(item); }}
            className="p-1.5 rounded bg-white/20 hover:bg-white/40 text-white"
            title={lt('下载', 'Download')}
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
            className="p-1.5 rounded bg-red-500/60 hover:bg-red-500 text-white"
            title={lt('删除', 'Delete')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-start">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item);
            }}
            className="rounded-md bg-white/20 px-2.5 py-1 text-xs text-white hover:bg-white/30"
            title={isVideo ? lt('查看详情', 'View details') : lt('查看完整请求', 'View full request')}
          >
            {isVideo ? lt('查看详情', 'View Details') : lt('查看完整请求', 'View Full Request')}
          </button>
        </div>
      </div>
      {/* 底部信息 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pointer-events-none">
        <div className="space-y-1 text-xs text-white/80">
          <div className="flex items-center justify-between">
            <span>{formattedDate}</span>
            <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">{isVideo ? mediaLabel : typeLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-white/65">
              {isVideo
                ? typeLabel
                : requestThumbnail
                  ? lt('含请求缩略图', 'Has request thumbnail')
                  : lt('无请求缩略图', 'No request thumbnail')}
            </span>
            <span className="shrink-0 text-white/65">
              {requestPrompt ? lt('提示词已隐藏', 'Prompt hidden') : lt('无提示词', 'No prompt')}
            </span>
          </div>
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
  lt: (zh: string, en: string) => string;
  isZh: boolean;
  resolveSourceTypeLabel: (sourceType: string) => string;
}

const ImageGrid: React.FC<ImageGridProps> = ({
  items,
  isLoading,
  hasMore,
  onLoadMore,
  onSelect,
  onDelete,
  onDownload,
  lt,
  isZh,
  resolveSourceTypeLabel,
}) => (
  <div className="flex-1 overflow-y-auto p-6">
    {items.length === 0 && !isLoading ? (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <p className="text-lg">{lt('暂无历史记录', 'No history yet')}</p>
        <p className="text-sm mt-2">{lt('生成的图片和视频会自动保存到这里', 'Generated images and videos will appear here automatically')}</p>
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
              lt={lt}
              isZh={isZh}
              resolveSourceTypeLabel={resolveSourceTypeLabel}
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
                  {lt('加载中...', 'Loading...')}
                </>
              ) : (
                lt('加载更多', 'Load More')
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
  selectionRequest,
  onSelectImage,
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '')
    .toLowerCase()
    .startsWith('zh');
  const lt = (zh: string, en: string) => (isZh ? zh : en);

  const { items, isLoading, hasMore, fetchItems, deleteItem, reset } =
    useGlobalImageHistoryStore();

  const [selectedItem, setSelectedItem] = useState<GlobalImageHistoryItem | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const queryOptions = {
    sourceType: filterType.trim() || undefined,
    search: searchQuery.trim() || undefined,
  };
  const resolveSourceTypeLabel = useCallback(
    (sourceType: string) => {
      const label = GLOBAL_HISTORY_SOURCE_TYPE_LABELS[sourceType];
      return label ? lt(label.zh, label.en) : sourceType;
    },
    [lt]
  );

  const clearPendingDelete = useCallback(() => {
    setPendingDelete((current) => {
      if (current) {
        clearTimeout(current.timer);
      }
      return null;
    });
  }, []);

  const restoreHiddenItem = useCallback((id: string) => {
    setHiddenItemIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const hideItem = useCallback((id: string) => {
    setHiddenItemIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // 打开时重置状态
  useEffect(() => {
    if (isOpen) {
      clearPendingDelete();
      setHiddenItemIds(new Set());
      reset();
    }
  }, [isOpen, clearPendingDelete, reset]);

  // 搜索/筛选改为服务端查询（防抖）
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fetchItems({ reset: true, query: queryOptions }).catch(() => {});
    }, 280);
    return () => clearTimeout(timer);
  }, [isOpen, fetchItems, queryOptions.search, queryOptions.sourceType]);

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
      fetchItems({ reset: false, query: queryOptions });
    }
  }, [isLoading, hasMore, fetchItems, queryOptions.search, queryOptions.sourceType]);

  const undoDelete = useCallback(() => {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    restoreHiddenItem(pendingDelete.id);
    setPendingDelete(null);
  }, [pendingDelete, restoreHiddenItem]);

  // 删除历史记录（5 秒撤销窗口）
  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm(lt('确定要删除这条历史记录吗？', 'Delete this history item?'))) return;

    if (pendingDelete) {
      clearTimeout(pendingDelete.timer);
      restoreHiddenItem(pendingDelete.id);
    }

    hideItem(id);
    setSelectedItem(null);

    const timer = setTimeout(async () => {
      const success = await deleteItem(id);
      restoreHiddenItem(id);
      setPendingDelete((current) => (current?.id === id ? null : current));
      if (!success) {
        window.alert(lt('删除失败，请稍后重试', 'Delete failed. Please try again later.'));
      }
    }, 5000);

    setPendingDelete({ id, timer });
  }, [deleteItem, hideItem, lt, pendingDelete, restoreHiddenItem]);

  // 下载媒体
  const handleDownload = useCallback((item: GlobalImageHistoryItem) => {
    const link = document.createElement('a');
    link.href = getGlobalHistoryMediaUrl(item);
    link.download = getGlobalHistoryDownloadFileName(item);
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  useEffect(() => {
    return () => {
      clearPendingDelete();
    };
  }, [clearPendingDelete]);

  const visibleItems = items.filter((item) => !hiddenItemIds.has(item.id));

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
        lt={lt}
      />

      {pendingDelete ? (
        <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-500/20 px-4 py-3 text-sm text-amber-100">
          <span>{lt('已标记删除，5 秒内可撤销', 'Marked for deletion. Undo available for 5 seconds.')}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={undoDelete}
            className="h-8 px-3 text-amber-100 hover:bg-amber-500/30 hover:text-white"
          >
            {lt('撤销', 'Undo')}
          </Button>
        </div>
      ) : null}

      {/* 图片网格 */}
      <ImageGrid
        items={visibleItems}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        onSelect={(item) => {
          if (selectionRequest && !isGlobalHistoryVideoItem(item)) {
            onSelectImage?.(item);
            return;
          }
          setSelectedItem(item);
        }}
        onDelete={handleDelete}
        onDownload={handleDownload}
        lt={lt}
        isZh={isZh}
        resolveSourceTypeLabel={resolveSourceTypeLabel}
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
