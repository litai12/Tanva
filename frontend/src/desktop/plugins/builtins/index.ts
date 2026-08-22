import { desktopPluginRegistry } from '../registry';
import {
  desktopConnectorsPlugin,
  TANVA_DESKTOP_CONNECTORS_PLUGIN_ID,
} from './DesktopConnectorsPlugin';
import { TANVA_CANVAS_PLUGIN_ID, tanvaCanvasPlugin } from './TanvaCanvasPlugin';
import {
  artifactWorkspacePlugin,
  TANVA_ARTIFACTS_PLUGIN_ID,
} from './ArtifactWorkspacePlugin';
import {
  mediaPreviewPlugin,
  TANVA_MEDIA_PREVIEW_PLUGIN_ID,
} from './MediaPreviewPlugin';

let builtinsRegistered = false;

export const registerBuiltinDesktopPlugins = (): void => {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  desktopPluginRegistry.register(tanvaCanvasPlugin);
  desktopPluginRegistry.register(artifactWorkspacePlugin);
  desktopPluginRegistry.register(mediaPreviewPlugin);
  desktopPluginRegistry.register(desktopConnectorsPlugin);
};

export {
  TANVA_ARTIFACTS_PLUGIN_ID,
  TANVA_CANVAS_PLUGIN_ID,
  TANVA_DESKTOP_CONNECTORS_PLUGIN_ID,
  TANVA_MEDIA_PREVIEW_PLUGIN_ID,
};
