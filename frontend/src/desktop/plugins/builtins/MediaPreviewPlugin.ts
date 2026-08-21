import MediaPreviewSurface from './MediaPreviewSurface';
import { TANVA_MEDIA_PREVIEW_PLUGIN_ID } from '../pluginIds';
import type { DesktopPluginDefinition } from '../types';

export const mediaPreviewPlugin: DesktopPluginDefinition = {
  manifest: {
    schemaVersion: 1,
    id: TANVA_MEDIA_PREVIEW_PLUGIN_ID,
    name: '媒体预览',
    version: '1.0.0',
    description: '在任务右侧预览并下载小T生成或引用的图片。',
    context: 'global',
    capabilities: ['media.preview', 'media.download'],
    permissions: ['asset:read'],
    activation: { userOpenable: false },
    surface: {
      title: '图片预览',
      defaultWidth: 720,
      minWidth: 420,
      maxWidth: 1100,
      supportsMaximize: false,
    },
  },
  component: MediaPreviewSurface,
};

export { TANVA_MEDIA_PREVIEW_PLUGIN_ID };
