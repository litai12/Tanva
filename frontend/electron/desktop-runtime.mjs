import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const PLACEHOLDER_RE = /\{(BaseDir|PythonExe|NodeExe)\}/g;

const normalizeRuntimePath = (value) => {
  if (typeof value !== 'string') return value;
  return value.replace(/[\\/]+/g, sep);
};

/**
 * Resolve the directory layout used by the reference desktop package.
 * The paths are intentionally discovered at runtime so the renderer never
 * receives filesystem details and development builds can point at a fixture.
 */
export const resolveDesktopRuntimePaths = ({
  packaged = false,
  resourcesPath = '',
  frontendRoot = '',
  env = process.env,
  platform = process.platform,
} = {}) => {
  const bundleRoot = env.TANVA_DESKTOP_BUNDLE_ROOT?.trim() ||
    (packaged ? resourcesPath : frontendRoot);
  const roots = [
    bundleRoot,
    bundleRoot ? join(bundleRoot, 'desktop-bundle') : '',
    bundleRoot ? join(bundleRoot, 'desktop-skills') : '',
    bundleRoot ? join(bundleRoot, 'skills') : '',
  ].filter(Boolean);
  const pythonCandidates = roots.flatMap((root) => [
    join(root, 'Settings', 'IsolatedPython', platform === 'win32' ? 'python.exe' : 'python3'),
    join(root, 'IsolatedPython', platform === 'win32' ? 'python.exe' : 'python3'),
  ]);
  const nodeCandidates = roots.flatMap((root) => [
    join(root, 'Settings', 'IsolatedNode', platform === 'win32' ? 'node.exe' : 'node'),
    join(root, 'IsolatedNode', platform === 'win32' ? 'node.exe' : 'node'),
  ]);
  const activeRoot = roots.find((root) => existsSync(join(root, 'Settings'))) || bundleRoot || '';
  const pythonExe = pythonCandidates.find((candidate) => existsSync(candidate)) || pythonCandidates[0] || '';
  const nodeExe = nodeCandidates.find((candidate) => existsSync(candidate)) || nodeCandidates[0] || '';
  return {
    baseDir: activeRoot,
    pythonExe,
    nodeExe,
    pythonAvailable: Boolean(pythonCandidates.find((candidate) => existsSync(candidate))),
    nodeAvailable: Boolean(nodeCandidates.find((candidate) => existsSync(candidate))),
  };
};

const replacePlaceholders = (value, paths) => {
  if (typeof value !== 'string') return value;
  let used = false;
  const replaced = value.replace(PLACEHOLDER_RE, (_match, key) => {
    used = true;
    const replacement = paths[{ BaseDir: 'baseDir', PythonExe: 'pythonExe', NodeExe: 'nodeExe' }[key]] || '';
    return key === 'BaseDir' && replacement && !replacement.endsWith(sep)
      ? `${replacement}${sep}`
      : replacement;
  });
  return used ? normalizeRuntimePath(replaced) : value;
};

/**
 * Expand only the three documented local runtime placeholders. Unknown
 * placeholders remain untouched and are rejected later by MCP validation,
 * preventing arbitrary environment-variable expansion.
 */
export const resolveMcpConfigPlaceholders = (config, paths) => {
  if (Array.isArray(config)) return config.map((item) => resolveMcpConfigPlaceholders(item, paths));
  if (!config || typeof config !== 'object') return replacePlaceholders(config, paths);
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, resolveMcpConfigPlaceholders(value, paths)])
  );
};
