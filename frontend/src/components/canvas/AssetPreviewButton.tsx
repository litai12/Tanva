import { Image as ImageIcon, Images } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/stores';

// 纯资产预览：图片/视频节点只保留资产区（flow.css 的 .tanva-asset-preview 规则），连线锚点不受影响。
export default function AssetPreviewButton() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const assetPreviewMode = useUIStore((s) => s.assetPreviewMode);
  const toggleAssetPreviewMode = useUIStore((s) => s.toggleAssetPreviewMode);
  const label = assetPreviewMode
    ? (isZh ? '退出纯资产预览' : 'Exit asset-only preview')
    : (isZh ? '纯资产预览（隐藏图片、视频节点的参数，只看产物）' : 'Asset-only preview (hide image/video node controls)');

  return (
    <div className="tanva-focus-mode-button">
      <button
        type="button"
        onClick={toggleAssetPreviewMode}
        aria-label={label}
        aria-pressed={assetPreviewMode}
        className="tanva-canvas-background-icon tanva-asset-preview-toggle"
        title={label}
      >
        {assetPreviewMode ? <ImageIcon className="w-4 h-4" /> : <Images className="w-4 h-4" />}
      </button>
    </div>
  );
}
