import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const stdioTemplate = (runtime, skill, script, extra = {}) => ({
  type: 'stdio',
  command: runtime,
  args: [join(extra.skillsRoot, skill, script), ...(extra.args || [])],
  ...(extra.cwd ? { cwd: join(extra.skillsRoot, skill, extra.cwd) } : {}),
  ...(extra.env ? { env: extra.env } : {}),
});

/**
 * Return the reference package's built-in MCP configuration for one connector.
 * The template is only usable when the corresponding bundled files exist.
 */
export const getBundledMcpConfig = (connectorId, runtimePaths, platform = process.platform) => {
  const baseDir = runtimePaths?.baseDir || '';
  const skillsRoot = join(baseDir, 'Settings', 'Skills');
  if (!baseDir || !runtimePaths) return null;
  if (connectorId === 'grasshopper') {
    return { type: 'sse', url: 'http://127.0.0.1:26929/mcp' };
  }
  if (connectorId === 'sketchup') {
    return stdioTemplate(runtimePaths.pythonExe, 'SketchUpMCP', 'stdio_bridge.py', {
      skillsRoot,
      env: { SU_MCP_PORT: '9876' },
    });
  }
  if (connectorId === 'rhino') {
    return stdioTemplate(runtimePaths.pythonExe, 'RhinoMCP', 'rhinomcp_launcher.py', {
      skillsRoot,
      env: { RHINO_MCP_HOST: '127.0.0.1', RHINO_MCP_PORT: '1999' },
    });
  }
  if (connectorId === 'autocad') {
    return stdioTemplate(runtimePaths.pythonExe, 'AutoCADMCP', 'cad_mcp_launcher.py', {
      skillsRoot,
      cwd: '.',
    });
  }
  if (connectorId === '3dsmax') {
    return stdioTemplate(runtimePaths.pythonExe, '3dsmaxMCP', '3dsmaxMCP_launcher.py', {
      skillsRoot,
      cwd: '.',
      env: { MCP_TOOL_PROFILE: 'full', NO_COLOR: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
  }
  if (connectorId === 'photoshop') {
    return stdioTemplate(runtimePaths.nodeExe, 'PhotoshopMCP', join('server', 'dist', 'index.js'), {
      skillsRoot,
      cwd: 'server',
      env: { LOG_LEVEL: '1', POSTHOG_DISABLED: '1', NO_COLOR: '1', PHOTOSHOP_MCP_HOME: join(baseDir, 'Settings', 'UserData', 'PhotoshopMCP') },
    });
  }
  if (connectorId === 'illustrator') {
    return stdioTemplate(runtimePaths.nodeExe, 'IllustratorMCP', join('server', 'dist', 'index.js'), {
      skillsRoot,
      cwd: 'server',
      env: { NO_COLOR: '1', ILLUSTRATOR_MCP_TRANSPORT: 'powershell' },
    });
  }
  if (connectorId === 'revit') {
    return stdioTemplate(runtimePaths.nodeExe, 'RevitMCP', join('server', 'build', 'index.js'), {
      skillsRoot,
      cwd: 'server',
      env: { NO_COLOR: '1' },
    });
  }
  if (connectorId === 'indesign') {
    return stdioTemplate(runtimePaths.pythonExe, 'InDesignMCP', 'indesign_mcp_launcher.py', {
      skillsRoot,
      cwd: '.',
      env: { NO_COLOR: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
  }
  if (connectorId === 'windows' && platform === 'win32') {
    return stdioTemplate(runtimePaths.pythonExe, 'WindowsMCP', 'windows_mcp_launcher.py', {
      skillsRoot,
      args: ['serve'],
      env: { ANONYMIZED_TELEMETRY: 'false', NO_COLOR: '1' },
    });
  }
  return null;
};

const referencedPaths = (config) => {
  const values = [config.command, config.cwd, ...(Array.isArray(config.args) ? config.args : [])];
  return values.filter((value) => typeof value === 'string' && isAbsolute(value));
};

export const isBundledMcpConfigAvailable = (config, platform = process.platform) => {
  if (!config || config.type !== 'stdio') return false;
  if (typeof config.command !== 'string' || !existsSync(config.command)) return false;
  // The reference bundle contains Windows launchers. A copied `.exe` must not
  // make a macOS/Linux connector look runnable merely because it exists.
  if (platform !== 'win32' && /\.exe$/i.test(config.command)) return false;
  return referencedPaths(config).every((value) => existsSync(value));
};
