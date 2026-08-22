import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopPluginRegistry, validateDesktopPluginManifest } from './registry.ts';
import type { DesktopPluginDefinition } from './types.ts';

const definition: DesktopPluginDefinition = {
  manifest: {
    schemaVersion: 1,
    id: 'test.surface',
    name: '测试工具面',
    version: '1.0.0',
    description: '测试注册合同',
    capabilities: ['test.open'],
    permissions: ['project:read'],
    surface: {
      title: '测试工具面',
      defaultWidth: 640,
      minWidth: 480,
      maxWidth: 960,
      supportsMaximize: true,
    },
  },
  component: () => null,
};

test('desktop plugin manifest validates stable ids and surface widths', () => {
  assert.doesNotThrow(() => validateDesktopPluginManifest(definition.manifest));
  assert.throws(
    () =>
      validateDesktopPluginManifest({
        ...definition.manifest,
        id: 'Invalid plugin id',
      }),
    /Invalid desktop plugin id/
  );
});

test('desktop plugin registry rejects duplicates and unregisters precisely', () => {
  const unregister = desktopPluginRegistry.register(definition);
  assert.equal(desktopPluginRegistry.get(definition.manifest.id), definition);
  assert.throws(() => desktopPluginRegistry.register(definition), /already registered/);
  unregister();
  assert.equal(desktopPluginRegistry.get(definition.manifest.id), null);
});

