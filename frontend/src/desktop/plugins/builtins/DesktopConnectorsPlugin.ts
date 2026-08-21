import DesktopConnectorsSurface from './DesktopConnectorsSurface';
import { TANVA_DESKTOP_CONNECTORS_PLUGIN_ID } from '../pluginIds';
import type { DesktopPluginDefinition } from '../types';

export const desktopConnectorsPlugin: DesktopPluginDefinition = {
  manifest: {
    schemaVersion: 1,
    id: TANVA_DESKTOP_CONNECTORS_PLUGIN_ID,
    name: '本机应用连接',
    version: '1.0.0',
    description: '检测、指定并启动小T后续可控制的专业桌面应用。',
    context: 'global',
    capabilities: [
      'native-app.discovery',
      'native-app.configuration',
      'native-app.launch',
    ],
    permissions: [
      'native-app:inspect',
      'native-app:configure',
      'native-app:launch',
    ],
    activation: {
      userOpenable: true,
    },
    surface: {
      title: '本机应用连接',
      defaultWidth: 560,
      minWidth: 440,
      maxWidth: 820,
      supportsMaximize: false,
    },
  },
  component: DesktopConnectorsSurface,
};

export { TANVA_DESKTOP_CONNECTORS_PLUGIN_ID };
