import React from 'react';
import { Button } from '../ui/button';
import { ChevronRight, Upload, Download, Trash2, Send, Image as ImageIcon, Box, Plus } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { imageUploadService } from '@/services/imageUploadService';
import { model3DUploadService, type Model3DData } from '@/services/model3DUploadService';
import { model3DPreviewService } from '@/services/model3DPreviewService';
import { personalLibraryApi } from '@/services/personalLibraryApi';
import {
  createPersonalAssetId,
  usePersonalLibraryStore,
  type PersonalAssetType,
  type PersonalLibraryAsset,
  type PersonalImageAsset,
  type PersonalModelAsset,
  type PersonalSvgAsset,
} from '@/stores/personalLibraryStore';
import type { StoredImageAsset } from '@/types/canvas';

const formatSize = (bytes?: number): string => {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

const getTypeLabel = (type: PersonalAssetType): { label: string; icon: React.ReactNode; bgColor: string } => {
  switch (type) {
    case '2d':
      return { label: '2D', icon: <ImageIcon className="w-3 h-3" />, bgColor: 'bg-blue-100 text-blue-700' };
    case '3d':
      return { label: '3D', icon: <Box className="w-3 h-3" />, bgColor: 'bg-purple-100 text-purple-700' };
    default:
      return { label: '矢量', icon: <ImageIcon className="w-3 h-3" />, bgColor: 'bg-green-100 text-green-700' };
  }
};

const LibraryPanel: React.FC = () => {
  const { showLibraryPanel, setShowLibraryPanel, focusMode } = useUIStore();
  const [isUploading, setUploading] = React.useState(false);
  const [isLibraryDragHovering, setLibraryDragHovering] = React.useState(false);
  const [selectedAsset, setSelectedAsset] = React.useState<PersonalLibraryAsset | null>(null);
  const [detailPosition, setDetailPosition] = React.useState<{ top: number } | null>(null);
  const addAsset = usePersonalLibraryStore((state) => state.addAsset);
  const removeAsset = usePersonalLibraryStore((state) => state.removeAsset);
  const updateAsset = usePersonalLibraryStore((state) => state.updateAsset);
  const mergeAssets = usePersonalLibraryStore((state) => state.mergeAssets);
  const allAssets = usePersonalLibraryStore((state) => state.assets);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const detailPanelRef = React.useRef<HTMLDivElement>(null);

  const handleModelThumbnailUpdate = React.useCallback(
    (assetId: string, thumbnail: string) => {
      updateAsset(assetId, { thumbnail });
      const current = usePersonalLibraryStore.getState().assets.find((item) => item.id === assetId);
      if (current) {
        void personalLibraryApi
          .upsert({ ...(current as any), thumbnail, updatedAt: Date.now() })
          .catch((error) => {
            console.warn('[LibraryPanel] 同步 3D 缩略图到个人库失败:', error);
          });
      }
    },
    [updateAsset]
  );

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 监听画布侧的库悬停事件，用于展示占位反馈
  React.useEffect(() => {
    const handleLibraryHover = (event: Event) => {
      const hovering = Boolean((event as CustomEvent<{ hovering: boolean }>).detail?.hovering);
      setLibraryDragHovering(hovering);
    };
    window.addEventListener('canvas:library-drag-hover', handleLibraryHover as EventListener);
    return () => {
      window.removeEventListener('canvas:library-drag-hover', handleLibraryHover as EventListener);
    };
  }, []);

  // 面板关闭时自动清理悬停态
  React.useEffect(() => {
    if (!showLibraryPanel && isLibraryDragHovering) {
      setLibraryDragHovering(false);
    }
  }, [showLibraryPanel, isLibraryDragHovering]);

  const triggerUpload = () => fileInputRef.current?.click();

  const upsertImageAsset = React.useCallback(
    (file: File, asset: NonNullable<Awaited<ReturnType<typeof imageUploadService.uploadImageFile>>['asset']>) => {
      const id = createPersonalAssetId('pl2d');
      const imageAsset: PersonalImageAsset = {
        id,
        type: '2d',
        name: file.name.replace(/\.[^/.]+$/, '') || asset.fileName || '未命名图片',
        url: asset.url,
        thumbnail: asset.url,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName ?? file.name,
        fileSize: file.size,
        contentType: asset.contentType ?? file.type,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAsset(imageAsset);
      void personalLibraryApi.upsert(imageAsset).catch((error) => {
        console.warn('[LibraryPanel] 同步图片资源到个人库失败:', error);
      });
    },
    [addAsset]
  );

  const upsertModelAsset = React.useCallback(
    (
      file: File,
      asset: NonNullable<Awaited<ReturnType<typeof model3DUploadService.uploadModelFile>>['asset']>
    ) => {
      const id = createPersonalAssetId('pl3d');
      const now = Date.now();
      const modelAsset: PersonalModelAsset = {
        id,
        type: '3d',
        name: file.name.replace(/\.[^/.]+$/, '') || asset.fileName || '未命名模型',
        url: asset.url,
        fileName: asset.fileName ?? file.name,
        fileSize: asset.fileSize ?? file.size,
        contentType: asset.contentType ?? file.type,
        format: asset.format,
        createdAt: now,
        updatedAt: now,
      };
      addAsset(modelAsset);
      void personalLibraryApi.upsert(modelAsset).catch((error) => {
        console.warn('[LibraryPanel] 同步 3D 资源到个人库失败:', error);
      });
      if (asset.url) {
        void model3DPreviewService
          .generatePreviewAndUpload(asset.url)
          .then((thumbnailUrl) => {
            if (thumbnailUrl) {
              handleModelThumbnailUpdate(id, thumbnailUrl);
            }
          })
          .catch((error) => {
            console.warn('[LibraryPanel] 3D 预览生成失败:', error);
          });
      }
    },
    [addAsset, handleModelThumbnailUpdate]
  );

  const handleUploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const is3D = file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf');

      if (is3D) {
        const result = await model3DUploadService.uploadModelFile(file, {
          dir: 'uploads/personal-library/models/',
        });
        if (!result.success || !result.asset) {
          alert(result.error || '3D 模型上传失败，请重试');
          return;
        }
        upsertModelAsset(file, result.asset);
      } else {
        const result = await imageUploadService.uploadImageFile(file, {
          dir: 'uploads/personal-library/images/',
        });
        if (!result.success || !result.asset) {
          alert(result.error || '图片上传失败，请重试');
          return;
        }
        upsertImageAsset(file, result.asset);
      }
    } finally {
      setUploading(false);
      resetFileInput();
    }
  };

  const handleDownload = (asset: PersonalLibraryAsset) => {
    try {
      const link = document.createElement('a');
      link.href = asset.url;
      link.download = asset.fileName || asset.name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(asset.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleRemoveAsset = (asset: PersonalLibraryAsset) => {
    if (!confirm(`确定要删除「${asset.name}」吗？`)) {
      return;
    }
    removeAsset(asset.id);
    setSelectedAsset(null);
    void personalLibraryApi.remove(asset.id).catch((error) => {
      console.warn('[LibraryPanel] 删除个人库资源失败:', error);
    });
  };

  const readDataUrl = async (url: string): Promise<string | null> => {
    try {
      // 🔥 修复：对于 OSS 图片，不使用 credentials，避免 CORS 问题
      const isOssUrl = url.includes('.aliyuncs.com');
      const response = await fetch(url, {
        mode: 'cors',
        credentials: isOssUrl ? 'omit' : 'include'
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn('[LibraryPanel] 将远程图片转换为 DataURL 失败:', error);
      return null;
    }
  };

  const handleSendToCanvas = async (asset: PersonalLibraryAsset) => {
    if (!asset.url) {
      alert('资源缺少可用的链接，无法发送到画板');
      return;
    }
    if (asset.type === '2d') {
      const inlineData =
        typeof asset.thumbnail === 'string' && asset.thumbnail.startsWith('data:')
          ? asset.thumbnail
          : null;
      const dataUrl = inlineData || (await readDataUrl(asset.url));

      const displayFileName = asset.fileName || `${asset.name}.png`;
      const payload: string | StoredImageAsset = dataUrl
        ? dataUrl
        : {
            id: asset.id,
            url: asset.url,
            src: asset.url,
            fileName: displayFileName,
            width: asset.width,
            height: asset.height,
            contentType: asset.contentType,
            localDataUrl: asset.thumbnail,
          };

      window.dispatchEvent(
        new CustomEvent('triggerQuickImageUpload', {
          detail: {
            imageData: payload,
            fileName: displayFileName,
            operationType: 'manual',
          },
        })
      );
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: '图片已发送到画板', type: 'success' } }));
      return;
    }

    if (asset.type === '3d') {
      const modelAsset = asset as PersonalModelAsset;
      const modelData: Model3DData = {
        url: modelAsset.url,
        key: modelAsset.key,
        path: modelAsset.path || modelAsset.url,
        format: modelAsset.format,
        fileName: modelAsset.fileName || modelAsset.name,
        fileSize: modelAsset.fileSize ?? 0,
        defaultScale: modelAsset.defaultScale || { x: 1, y: 1, z: 1 },
        defaultRotation: modelAsset.defaultRotation || { x: 0, y: 0, z: 0 },
        timestamp: modelAsset.updatedAt || Date.now(),
        camera: modelAsset.camera,
      };
      window.dispatchEvent(
        new CustomEvent('canvas:insert-model3d', {
          detail: {
            modelData,
          },
        })
      );
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: '3D 模型已发送到画板', type: 'success' } }));
    }

    if (asset.type === 'svg') {
      const svgAsset = asset as PersonalSvgAsset;
      const displayFileName = svgAsset.fileName || `${svgAsset.name}.svg`;

      window.dispatchEvent(
        new CustomEvent('canvas:insert-svg', {
          detail: {
            fileName: displayFileName,
            asset: {
              id: svgAsset.id,
              url: svgAsset.url,
              svgContent: svgAsset.svgContent,
              width: svgAsset.width,
              height: svgAsset.height,
              name: svgAsset.name,
              fileName: displayFileName,
            },
          },
        })
      );
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'SVG 已发送到画板', type: 'success' } }));
    }
  };

  const handleClose = () => {
    setShowLibraryPanel(false);
    setSelectedAsset(null);
  };

  const handleAssetClick = (asset: PersonalLibraryAsset, event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // 计算详情面板的位置，使其与点击的缩略图对齐
    setDetailPosition({ top: rect.top });
    setSelectedAsset(asset);
  };

  // 拖拽开始处理
  const handleDragStart = (asset: PersonalLibraryAsset, event: React.DragEvent) => {
    // 设置拖拽数据
    if (asset.type === '2d') {
      // 2D 图片：设置 URL，DrawingController 会自动处理
      event.dataTransfer.setData('text/uri-list', asset.url);
      event.dataTransfer.setData('text/plain', asset.url);
      event.dataTransfer.setData('application/x-tanva-asset', JSON.stringify({
        type: '2d',
        id: asset.id,
        url: asset.url,
        name: asset.name,
        fileName: asset.fileName,
      }));
    } else if (asset.type === '3d') {
      // 3D 模型：设置自定义数据
      const modelAsset = asset as PersonalModelAsset;
      event.dataTransfer.setData('application/x-tanva-asset', JSON.stringify({
        type: '3d',
        id: modelAsset.id,
        url: modelAsset.url,
        name: modelAsset.name,
        fileName: modelAsset.fileName,
        format: modelAsset.format,
        key: modelAsset.key,
        path: modelAsset.path,
        defaultScale: modelAsset.defaultScale,
        defaultRotation: modelAsset.defaultRotation,
        camera: modelAsset.camera,
        fileSize: modelAsset.fileSize,
        updatedAt: modelAsset.updatedAt,
      }));
    } else if (asset.type === 'svg') {
      const svgAsset = asset as PersonalSvgAsset;
      event.dataTransfer.setData('text/uri-list', svgAsset.url);
      event.dataTransfer.setData('text/plain', svgAsset.url);
      event.dataTransfer.setData('application/x-tanva-asset', JSON.stringify({
        type: 'svg',
        id: svgAsset.id,
        url: svgAsset.url,
        name: svgAsset.name,
        fileName: svgAsset.fileName,
        width: svgAsset.width,
        height: svgAsset.height,
        svgContent: svgAsset.svgContent,
      }));
    }
    event.dataTransfer.effectAllowed = 'copy';
  };

  // 拖拽结束处理（用于 3D 模型）
  React.useEffect(() => {
    const handleDrop = (event: DragEvent) => {
      const assetData = event.dataTransfer?.getData('application/x-tanva-asset');
      if (!assetData) return;

      try {
        const asset = JSON.parse(assetData);
        if (asset.type === '3d') {
          // 3D 模型需要通过自定义事件处理
          const modelData: Model3DData = {
            url: asset.url,
            key: asset.key,
            path: asset.path || asset.url,
            format: asset.format,
            fileName: asset.fileName || asset.name,
            fileSize: asset.fileSize ?? 0,
            defaultScale: asset.defaultScale || { x: 1, y: 1, z: 1 },
            defaultRotation: asset.defaultRotation || { x: 0, y: 0, z: 0 },
            timestamp: asset.updatedAt || Date.now(),
            camera: asset.camera,
          };
          window.dispatchEvent(
            new CustomEvent('canvas:insert-model3d', {
              detail: { modelData },
            })
          );
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: '3D 模型已添加到画板', type: 'success' } }));
        }
      } catch (error) {
        console.warn('[LibraryPanel] 解析拖拽数据失败:', error);
      }
    };

    // 监听从画布拖拽到库的事件
    const handleAddToLibrary = (event: CustomEvent<{
      type: '2d' | '3d' | 'svg';
      url: string;
      name?: string;
      fileName?: string;
      width?: number;
      height?: number;
      contentType?: string;
    }>) => {
      const { type, url, name, fileName, width, height, contentType } = event.detail;
      if (!url) return;

      if (type === '2d') {
        const id = createPersonalAssetId('pl2d');
        const imageAsset: PersonalImageAsset = {
          id,
          type: '2d',
          name: name || fileName?.replace(/\.[^/.]+$/, '') || '画布图片',
          url,
          thumbnail: url,
          width,
          height,
          fileName: fileName || '画布图片.png',
          contentType: contentType || 'image/png',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        addAsset(imageAsset);
        void personalLibraryApi.upsert(imageAsset).catch((error) => {
          console.warn('[LibraryPanel] 同步图片资源到个人库失败:', error);
        });
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '图片已添加到个人库', type: 'success' } }));
        setLibraryDragHovering(false);
      }
    };

    window.addEventListener('drop', handleDrop);
    window.addEventListener('canvas:add-to-library', handleAddToLibrary as EventListener);
    return () => {
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('canvas:add-to-library', handleAddToLibrary as EventListener);
    };
  }, [addAsset]);

  // 点击外部关闭详情面板
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (detailPanelRef.current && !detailPanelRef.current.contains(event.target as Node)) {
        // 检查是否点击的是缩略图
        const target = event.target as HTMLElement;
        if (!target.closest('[data-asset-thumbnail]')) {
          setSelectedAsset(null);
        }
      }
    };

    if (selectedAsset) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedAsset]);

  // 打开面板时从后端拉取个人库，避免仅依赖 localStorage
  React.useEffect(() => {
    if (focusMode || !showLibraryPanel) return;
    let cancelled = false;
    void personalLibraryApi
      .list()
      .then((assets) => {
        if (cancelled) return;
        if (Array.isArray(assets) && assets.length) {
          mergeAssets(assets);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[LibraryPanel] 拉取个人库失败:', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [focusMode, showLibraryPanel, mergeAssets]);

  // 专注模式或面板关闭时隐藏
  if (focusMode || !showLibraryPanel) return null;

  return (
    <>
      {/* 详情面板 - 在库面板左侧弹出 */}
      {selectedAsset && (
        <div
          ref={detailPanelRef}
          className="fixed right-[336px] w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-[1001] overflow-hidden"
          style={{
            top: detailPosition?.top ?? 100,
            maxHeight: 'calc(100vh - 100px)',
          }}
        >
          {/* 预览图 */}
          <div className="w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
            {(selectedAsset.type === '2d' || selectedAsset.type === 'svg') ? (
              <img
                src={selectedAsset.thumbnail || selectedAsset.url}
                alt={selectedAsset.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <ModelPreview
                asset={selectedAsset as PersonalModelAsset}
                onThumbnailReady={handleModelThumbnailUpdate}
                large
              />
            )}
          </div>

          {/* 资源信息 */}
          <div className="p-3 space-y-2">
            {/* 类型标签 */}
            <div className="flex items-center gap-2">
              {(() => {
                const typeInfo = getTypeLabel(selectedAsset.type);
                return (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeInfo.bgColor}`}>
                    {typeInfo.icon}
                    {typeInfo.label}
                  </span>
                );
              })()}
            </div>

            {/* 名称 */}
            <div>
              <div className="text-sm font-medium text-gray-900 truncate" title={selectedAsset.name}>
                {selectedAsset.name}
              </div>
            </div>

            {/* 尺寸/格式 */}
            {(selectedAsset.type === '2d' || selectedAsset.type === 'svg') ? (
              <div>
                <div className="text-xs text-gray-500">尺寸</div>
                <div className="text-sm text-gray-700">
                  {(selectedAsset as PersonalImageAsset | PersonalSvgAsset).width ?? '-'} × {(selectedAsset as PersonalImageAsset | PersonalSvgAsset).height ?? '-'}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-xs text-gray-500">格式</div>
                <div className="text-sm text-gray-700">
                  {(selectedAsset as PersonalModelAsset).format?.toUpperCase() ?? '-'}
                </div>
              </div>
            )}

            {/* 文件大小 */}
            <div>
              <div className="text-xs text-gray-500">大小</div>
              <div className="text-sm text-gray-700">{formatSize(selectedAsset.fileSize)}</div>
            </div>

            {/* 更新时间 */}
            <div>
              <div className="text-xs text-gray-500">更新时间</div>
              <div className="text-sm text-gray-700">{formatDate(selectedAsset.updatedAt)}</div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="p-3 pt-0 flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => void handleSendToCanvas(selectedAsset)}
              title="发送到画板"
            >
              <Send className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => handleDownload(selectedAsset)}
              title="下载"
            >
              <Download className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => handleRemoveAsset(selectedAsset)}
              title="删除"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* 主面板 */}
      <div
        data-library-drop-zone="true"
        className={`fixed top-0 right-0 h-full w-80 bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border-l border-liquid-glass z-[1000] transform transition-transform duration-[50ms] ease-out ${
          showLibraryPanel ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {isLibraryDragHovering && (
          <div className="pointer-events-none absolute inset-0 z-[1010] flex items-start justify-center px-3 pt-3">
            <div className="w-full h-24 rounded-xl border-2 border-dashed border-blue-400/80 bg-blue-50/85 text-blue-700 flex items-center justify-center font-medium shadow-[0_10px_30px_rgba(59,130,246,0.15)] backdrop-blur-sm">
              松开添加到库
            </div>
          </div>
        )}
        {/* 面板头部 */}
        <div className="flex items-center justify-between px-4 pt-6 pb-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-gray-600 hover:text-gray-800 bg-transparent"
            onClick={handleClose}
            title="收起库面板"
            aria-label="收起库面板"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold text-gray-800">库</h2>
        </div>

        {/* 分隔线 */}
        <div className="mx-4 h-px bg-gray-200" />

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,.glb,.gltf"
          onChange={handleUploadFiles}
          style={{ display: 'none' }}
        />

        {/* 资源网格 */}
        <div className="flex-1 overflow-y-auto pb-12 relative">
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {/* 资源列表 */}
              {allAssets.map((asset) => {
                const is2dOrSvg = asset.type === '2d' || asset.type === 'svg';
                const isSelected = selectedAsset?.id === asset.id;
                const typeLabel = asset.type === '2d' ? 'IMG' : asset.type === '3d' ? '3D' : 'SVG';

                return (
                  <div
                    key={asset.id}
                    data-asset-thumbnail
                    draggable
                    className={`aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-grab transition-all hover:ring-2 hover:ring-blue-400 active:cursor-grabbing relative ${
                      isSelected ? 'ring-2 ring-blue-500' : ''
                    }`}
                    onClick={(e) => handleAssetClick(asset, e)}
                    onDragStart={(e) => handleDragStart(asset, e)}
                  >
                    {is2dOrSvg ? (
                      <img
                        src={asset.thumbnail || asset.url}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <ModelPreview
                        asset={asset as PersonalModelAsset}
                        onThumbnailReady={handleModelThumbnailUpdate}
                      />
                    )}
                    {/* 类型标签 */}
                    <div className="absolute bottom-1 right-1 px-1 py-0.5 bg-black/60 text-white text-[8px] font-medium rounded">
                      {typeLabel}
                    </div>
                  </div>
                );
              })}

              {/* 上传按钮方格 - 放在最后 */}
              <div
                className="aspect-square rounded-lg overflow-hidden bg-gray-50 border border-gray-200 cursor-pointer transition-all hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center"
                onClick={triggerUpload}
              >
                {isUploading ? (
                  <div className="text-gray-400 text-xs">上传中...</div>
                ) : (
                  <Plus className="w-8 h-8 text-gray-400" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 面板底部 */}
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-white/80 backdrop-blur-sm">
          <div className="text-xs text-gray-500 text-center">
            共 {allAssets.length} 个资源
          </div>
        </div>
      </div>
    </>
  );
};

// 3D 模型预览组件
interface ModelPreviewProps {
  asset: PersonalModelAsset;
  onThumbnailReady: (id: string, thumbnail: string) => void;
  large?: boolean;
}

const ModelPreview: React.FC<ModelPreviewProps> = ({ asset, onThumbnailReady, large }) => {
  const [previewSrc, setPreviewSrc] = React.useState<string | null>(asset.thumbnail ?? null);
  const [isLoading, setIsLoading] = React.useState(false);
  const requestStartedRef = React.useRef(false);

  React.useEffect(() => {
    setPreviewSrc(asset.thumbnail ?? null);
  }, [asset.thumbnail]);

  React.useEffect(() => {
    if (asset.thumbnail || !asset.url || requestStartedRef.current) {
      return;
    }
    let cancelled = false;
    requestStartedRef.current = true;
    setIsLoading(true);
    model3DPreviewService
      .generatePreviewAndUpload(asset.url)
      .then((thumbnailUrl) => {
        if (cancelled) return;
        if (thumbnailUrl) {
          setPreviewSrc(thumbnailUrl);
          onThumbnailReady(asset.id, thumbnailUrl);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[LibraryPanel] 3D 预览生成失败:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.thumbnail, asset.url, onThumbnailReady]);

  if (previewSrc) {
    return (
      <img
        src={previewSrc}
        alt={`${asset.name} 预览`}
        className={`w-full h-full ${large ? 'object-contain' : 'object-cover'}`}
        draggable={false}
      />
    );
  }

  return (
    <div className="w-full h-full bg-gradient-to-br from-purple-500 to-indigo-600 flex flex-col items-center justify-center text-white">
      <Box className={large ? 'w-8 h-8' : 'w-4 h-4'} />
      {isLoading && <div className={`mt-1 ${large ? 'text-xs' : 'text-[8px]'}`}>加载中</div>}
    </div>
  );
};

export default LibraryPanel;
