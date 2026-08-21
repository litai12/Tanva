import ArtifactWorkspaceSurface from './ArtifactWorkspaceSurface';
import { TANVA_ARTIFACTS_PLUGIN_ID } from '../pluginIds';
import type { DesktopPluginDefinition } from '../types';

export const artifactWorkspacePlugin: DesktopPluginDefinition = {
  manifest: {
    schemaVersion: 1,
    id: TANVA_ARTIFACTS_PLUGIN_ID,
    name: '文件工作台',
    version: '1.0.0',
    description: '预览、编辑和导出 PPT、Excel 与文档产物。',
    context: 'global',
    capabilities: [
      'artifact.preview',
      'artifact.spreadsheet.export',
      'artifact.canvas.handoff',
    ],
    permissions: ['asset:read', 'asset:write', 'task:read'],
    activation: { userOpenable: false },
    surface: {
      title: '文件工作台',
      defaultWidth: 900,
      minWidth: 620,
      maxWidth: 1500,
      supportsMaximize: true,
    },
  },
  component: ArtifactWorkspaceSurface,
};

export { TANVA_ARTIFACTS_PLUGIN_ID };
