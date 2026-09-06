import ReportBuilderSurface from './ReportBuilderSurface';
import { TANVA_REPORT_BUILDER_PLUGIN_ID } from '../pluginIds';
import type { DesktopPluginDefinition } from '../types';

export const reportBuilderPlugin: DesktopPluginDefinition = {
  manifest: {
    schemaVersion: 1,
    id: TANVA_REPORT_BUILDER_PLUGIN_ID,
    name: '作品汇报制作',
    version: '1.0.0',
    description: '按章节、素材、样式和播放效果生成建筑作品汇报。',
    context: 'global',
    capabilities: ['report.configure', 'report.asset-upload', 'report.generate'],
    permissions: ['asset:read', 'asset:write', 'task:read', 'task:control'],
    activation: { userOpenable: true },
    surface: {
      title: '作品汇报制作',
      defaultWidth: 760,
      minWidth: 560,
      maxWidth: 1100,
      supportsMaximize: true,
    },
  },
  component: ReportBuilderSurface,
};

export { TANVA_REPORT_BUILDER_PLUGIN_ID };
