import TanvaCanvasSurface from './TanvaCanvasSurface';
import { TANVA_CANVAS_PLUGIN_ID } from '../pluginIds';
import type { DesktopPluginDefinition } from '../types';

export const tanvaCanvasPlugin: DesktopPluginDefinition = {
  manifest: {
    schemaVersion: 1,
    id: TANVA_CANVAS_PLUGIN_ID,
    name: 'Tanva 画布',
    version: '1.0.0',
    description: '项目、工作流、素材以及图片和视频产物的第一方工具面。',
    capabilities: [
      'canvas.project.manage',
      'canvas.flow.edit',
      'canvas.node.run',
      'canvas.asset.inspect',
    ],
    permissions: [
      'project:read',
      'project:write',
      'canvas:read',
      'canvas:write',
      'asset:read',
      'asset:write',
      'task:read',
      'task:control',
    ],
    surface: {
      title: 'Tanva 画布',
      defaultWidth: 820,
      minWidth: 560,
      maxWidth: 1440,
      supportsMaximize: true,
    },
  },
  component: TanvaCanvasSurface,
};

export { TANVA_CANVAS_PLUGIN_ID };
