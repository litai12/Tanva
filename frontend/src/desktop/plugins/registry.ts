import { useSyncExternalStore } from 'react';
import {
  DESKTOP_PLUGIN_SCHEMA_VERSION,
  type DesktopPluginDefinition,
  type DesktopPluginManifest,
} from './types';

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const validateDesktopPluginManifest = (
  manifest: DesktopPluginManifest
): void => {
  if (manifest.schemaVersion !== DESKTOP_PLUGIN_SCHEMA_VERSION) {
    throw new Error(`Unsupported desktop plugin schema: ${manifest.schemaVersion}`);
  }
  if (!PLUGIN_ID_PATTERN.test(manifest.id)) {
    throw new Error(`Invalid desktop plugin id: ${manifest.id}`);
  }
  if (!manifest.name.trim() || !manifest.surface.title.trim()) {
    throw new Error(`Desktop plugin ${manifest.id} must have a name and surface title`);
  }
  if (!VERSION_PATTERN.test(manifest.version)) {
    throw new Error(`Invalid desktop plugin version: ${manifest.version}`);
  }
  const { defaultWidth, minWidth, maxWidth } = manifest.surface;
  if (
    !Number.isFinite(defaultWidth) ||
    !Number.isFinite(minWidth) ||
    !Number.isFinite(maxWidth) ||
    minWidth < 320 ||
    minWidth > defaultWidth ||
    defaultWidth > maxWidth
  ) {
    throw new Error(`Invalid surface width contract for ${manifest.id}`);
  }
};

class DesktopPluginRegistry {
  private readonly definitions = new Map<string, DesktopPluginDefinition>();
  private listeners = new Set<() => void>();
  private snapshot: DesktopPluginDefinition[] = [];

  register(definition: DesktopPluginDefinition): () => void {
    validateDesktopPluginManifest(definition.manifest);
    const { id } = definition.manifest;
    if (this.definitions.has(id)) {
      throw new Error(`Desktop plugin already registered: ${id}`);
    }
    this.definitions.set(id, definition);
    this.emit();
    return () => this.unregister(id);
  }

  unregister(id: string): void {
    if (!this.definitions.delete(id)) return;
    this.emit();
  }

  get(id: string | null | undefined): DesktopPluginDefinition | null {
    if (!id) return null;
    return this.definitions.get(id) ?? null;
  }

  list(): DesktopPluginDefinition[] {
    return this.snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DesktopPluginDefinition[] => this.snapshot;

  private emit(): void {
    this.snapshot = Array.from(this.definitions.values()).sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name)
    );
    this.listeners.forEach((listener) => listener());
  }
}

export const desktopPluginRegistry = new DesktopPluginRegistry();

export const useDesktopPlugins = (): DesktopPluginDefinition[] =>
  useSyncExternalStore(
    desktopPluginRegistry.subscribe,
    desktopPluginRegistry.getSnapshot,
    desktopPluginRegistry.getSnapshot
  );

