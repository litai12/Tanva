import type { ComponentType, LazyExoticComponent } from 'react';

export const DESKTOP_PLUGIN_SCHEMA_VERSION = 1 as const;

export type DesktopPluginPermission =
  | 'project:read'
  | 'project:write'
  | 'canvas:read'
  | 'canvas:write'
  | 'asset:read'
  | 'asset:write'
  | 'task:read'
  | 'task:control'
  | 'native-app:inspect'
  | 'native-app:launch'
  | 'native-app:configure';

export interface DesktopPluginManifest {
  schemaVersion: typeof DESKTOP_PLUGIN_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  context?: 'project' | 'global';
  capabilities: string[];
  permissions: DesktopPluginPermission[];
  activation?: {
    userOpenable: boolean;
  };
  surface: {
    title: string;
    defaultWidth: number;
    minWidth: number;
    maxWidth: number;
    supportsMaximize: boolean;
  };
}

export interface DesktopPluginComponentProps {
  projectId: string | null;
  isMaximized: boolean;
  closeSurface: () => void;
  restoreSurface: () => void;
}

export type DesktopPluginComponent =
  | ComponentType<DesktopPluginComponentProps>
  | LazyExoticComponent<ComponentType<DesktopPluginComponentProps>>;

export interface DesktopPluginDefinition {
  manifest: DesktopPluginManifest;
  component: DesktopPluginComponent;
}
