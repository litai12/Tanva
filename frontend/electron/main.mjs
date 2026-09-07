import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DesktopCapabilityHost,
  validateMcpServerConfig,
  validateToolArguments,
} from './capability-host.mjs';
import { createQuitCoordinator } from './app-lifecycle.mjs';
import {
  resolveDesktopRuntimePaths,
  resolveMcpConfigPlaceholders,
} from './desktop-runtime.mjs';
import { parseJsonDocument, selectMcpServer } from './mcp-config-normalizer.mjs';
import {
  getBundledMcpConfig,
  isBundledMcpConfigAvailable,
} from './desktop-mcp-templates.mjs';
import { computeUse } from './compute-use.mjs';
import { isComputeUseAction } from './compute-use-actions.mjs';
import { LocalCodexClient } from './local-codex-client.mjs';
import { ConstructionCapabilityHost, constructionToolDefinitions } from './construction-host.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(currentDir, '..');
const devRendererUrl = process.env.ELECTRON_RENDERER_URL?.trim() || null;
const trustedDevOrigin = devRendererUrl ? new URL(devRendererUrl).origin : null;
const desktopRuntimePaths = resolveDesktopRuntimePaths({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  frontendRoot,
});

const connectorDefinitions = Object.freeze({
  sketchup: {
    name: 'SketchUp',
    darwin: ['/Applications/SketchUp 2026/SketchUp.app', '/Applications/SketchUp 2025/SketchUp.app', '/Applications/SketchUp 2024/SketchUp.app'],
    win32: ['SketchUp/SketchUp 2026/SketchUp.exe', 'SketchUp/SketchUp 2025/SketchUp.exe', 'SketchUp/SketchUp 2024/SketchUp.exe'],
  },
  rhino: {
    name: 'Rhino',
    darwin: ['/Applications/Rhino 8.app', '/Applications/Rhinoceros.app'],
    win32: ['Rhino 8/System/Rhino.exe', 'Rhino 7/System/Rhino.exe'],
  },
  grasshopper: {
    name: 'Grasshopper',
    hostedBy: 'rhino',
    darwin: ['/Applications/Rhino 8.app', '/Applications/Rhinoceros.app'],
    win32: ['Rhino 8/System/Rhino.exe', 'Rhino 7/System/Rhino.exe'],
  },
  autocad: {
    name: 'AutoCAD',
    darwin: ['/Applications/Autodesk/AutoCAD 2026/AutoCAD 2026.app', '/Applications/Autodesk/AutoCAD 2025/AutoCAD 2025.app', '/Applications/Autodesk/AutoCAD 2024/AutoCAD 2024.app'],
    win32: ['Autodesk/AutoCAD 2026/acad.exe', 'Autodesk/AutoCAD 2025/acad.exe', 'Autodesk/AutoCAD 2024/acad.exe'],
  },
  photoshop: {
    name: 'Photoshop',
    darwin: ['/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app', '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app', '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app'],
    win32: ['Adobe/Adobe Photoshop 2026/Photoshop.exe', 'Adobe/Adobe Photoshop 2025/Photoshop.exe', 'Adobe/Adobe Photoshop 2024/Photoshop.exe'],
  },
  '3dsmax': {
    name: '3ds Max',
    darwin: [],
    win32: ['Autodesk/3ds Max 2026/3dsmax.exe', 'Autodesk/3ds Max 2025/3dsmax.exe', 'Autodesk/3ds Max 2024/3dsmax.exe'],
  },
  blender: {
    name: 'Blender',
    darwin: ['/Applications/Blender.app', '/Applications/Blender 4.5/Blender.app', '/Applications/Blender 4.4/Blender.app'],
    win32: ['Blender Foundation/Blender 4.5/blender.exe', 'Blender Foundation/Blender 4.4/blender.exe', 'Blender Foundation/Blender/blender.exe'],
  },
  revit: {
    name: 'Revit',
    darwin: [],
    win32: ['Autodesk/Revit 2026/Revit.exe', 'Autodesk/Revit 2025/Revit.exe', 'Autodesk/Revit 2024/Revit.exe'],
  },
  illustrator: {
    name: 'Illustrator',
    darwin: ['/Applications/Adobe Illustrator 2026/Adobe Illustrator.app', '/Applications/Adobe Illustrator 2025/Adobe Illustrator.app'],
    win32: ['Adobe/Adobe Illustrator 2026/Support Files/Contents/Windows/Illustrator.exe', 'Adobe/Adobe Illustrator 2025/Support Files/Contents/Windows/Illustrator.exe'],
  },
  indesign: {
    name: 'InDesign',
    darwin: ['/Applications/Adobe InDesign 2026/Adobe InDesign.app', '/Applications/Adobe InDesign 2025/Adobe InDesign.app'],
    win32: ['Adobe/Adobe InDesign 2026/InDesign.exe', 'Adobe/Adobe InDesign 2025/InDesign.exe'],
  },
  windows: {
    name: 'Windows',
    darwin: [],
    win32: [],
  },
  architecture: { name: '建筑工程计算', internal: true, darwin: [], win32: [] },
  business: { name: '采购与供应链', internal: true, darwin: [], win32: [] },
});

app.setName('Tanva');
app.setAppUserModelId('com.tanva.desktop');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let desktopWorkspaceRoot = null;
const capabilityHost = new DesktopCapabilityHost();
const constructionHost = new ConstructionCapabilityHost(app.getPath('userData'));
const localCodex = new LocalCodexClient({
  executable: process.env.TANVA_CODEX_EXECUTABLE || process.env.CODEX_EXEC_PATH,
  cwd: frontendRoot,
  xiaotBridgePath: join(currentDir, 'xiaot-agent-mcp-bridge.mjs'),
  xiaotEndpoint: process.env.TANVA_XIAOT_AGENT_URL,
});
const quitCoordinator = createQuitCoordinator({
  cleanup: async () => {
    await capabilityHost.disconnectAll();
    await localCodex.close();
  },
  quit: () => app.quit(),
});

const getPackagedRendererRoot = () => resolve(process.resourcesPath, 'renderer');

const isPathWithin = (candidate, root) => {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
};

const isTrustedAppUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') {
      const rendererRoot = app.isPackaged
        ? getPackagedRendererRoot()
        : resolve(frontendRoot, 'dist');
      return isPathWithin(fileURLToPath(url), rendererRoot);
    }
    return Boolean(trustedDevOrigin && url.origin === trustedDevOrigin);
  } catch {
    return false;
  }
};

const isTrustedSender = (event) => isTrustedAppUrl(event.sender.getURL());

const getAuthSessionPath = () => join(app.getPath('userData'), 'auth-session.enc');

const normalizeAuthTokens = (value) => {
  if (!value || typeof value !== 'object') return null;
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken.trim() : '';
  const refreshToken = typeof value.refreshToken === 'string' ? value.refreshToken.trim() : '';
  if (!accessToken && !refreshToken) return null;
  if (accessToken.length > 32 * 1024 || refreshToken.length > 32 * 1024) {
    throw new Error('Auth token payload is too large');
  }
  return { accessToken, refreshToken };
};

const readEncryptedAuthSession = async () => {
  if (!safeStorage.isEncryptionAvailable()) {
    return { available: false, tokens: null };
  }
  try {
    const encrypted = Buffer.from(await readFile(getAuthSessionPath(), 'utf8'), 'base64');
    const parsed = JSON.parse(safeStorage.decryptString(encrypted));
    return { available: true, tokens: normalizeAuthTokens(parsed?.tokens) };
  } catch {
    return { available: true, tokens: null };
  }
};

const writeEncryptedAuthSession = async (tokens) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const normalized = normalizeAuthTokens(tokens);
  if (!normalized) return false;
  const sessionPath = getAuthSessionPath();
  const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, tokens: normalized }));
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  return true;
};

const clearEncryptedAuthSession = async () => {
  try {
    await unlink(getAuthSessionPath());
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return true;
};

const installAuthSessionIpc = () => {
  ipcMain.handle('tanva:auth:read', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted auth session request');
    return readEncryptedAuthSession();
  });
  ipcMain.handle('tanva:auth:write', async (event, tokens) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted auth session request');
    return writeEncryptedAuthSession(tokens);
  });
  ipcMain.handle('tanva:auth:clear', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted auth session request');
    return clearEncryptedAuthSession();
  });
};

const installClipboardIpc = () => {
  ipcMain.handle('tanva:clipboard:write-text', async (event, value) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted clipboard request');
    if (typeof value !== 'string') throw new Error('Clipboard text must be a string');
    if (value.length > 5 * 1024 * 1024) throw new Error('Clipboard text is too large');
    clipboard.writeText(value);
    return clipboard.readText() === value;
  });
};

const installExternalTargetIpc = () => {
  ipcMain.handle('tanva:open-target', async (event, value) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted external target request');
    const target = typeof value?.target === 'string' ? value.target.trim() : '';
    const kind = value?.kind === 'path' ? 'path' : 'url';
    if (!target || target.length > 8 * 1024 || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(target)) {
      throw new Error('打开目标无效');
    }
    if (kind === 'url') {
      let url;
      try { url = new URL(target); } catch { throw new Error('外部链接无效'); }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('只允许打开 HTTP(S) 链接');
      }
      await shell.openExternal(url.toString());
      return { ok: true };
    }
    if (!isAbsolute(target)) throw new Error('本地路径必须是绝对路径');
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });
};

// Safe desktop "hands": capture the trusted renderer and expose update
// discovery without granting the renderer filesystem or process access.
const installDesktopCapabilityIpc = () => {
  ipcMain.handle('tanva:workspace:choose', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted workspace request');
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) throw new Error('Window unavailable');
    const result = await dialog.showOpenDialog(owner, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { selected: false, root: null };
    desktopWorkspaceRoot = resolve(result.filePaths[0]);
    return { selected: true, root: desktopWorkspaceRoot };
  });
  ipcMain.handle('tanva:workspace:status', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted workspace request');
    return { root: desktopWorkspaceRoot };
  });
  const resolveWorkspacePath = (relativePath = '') => {
    if (!desktopWorkspaceRoot) throw new Error('请先选择工作文件夹');
    if (typeof relativePath !== 'string' || relativePath.length > 1024 || /[\u0000-\u001f]/.test(relativePath)) throw new Error('文件路径无效');
    const candidate = resolve(desktopWorkspaceRoot, relativePath);
    if (!isPathWithin(candidate, desktopWorkspaceRoot)) throw new Error('文件路径必须位于工作文件夹内');
    return candidate;
  };
  ipcMain.handle('tanva:workspace:list', async (event, relativePath = '') => {
    if (!isTrustedSender(event)) throw new Error('Untrusted workspace request');
    const root = resolveWorkspacePath(relativePath);
    const output = [];
    const visit = async (directory, prefix, depth) => {
      if (depth > 4 || output.length >= 500) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const child = join(directory, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { output.push({ path: rel, kind: 'directory' }); await visit(child, rel, depth + 1); }
        else if (entry.isFile()) { const info = await stat(child); output.push({ path: rel, kind: 'file', size: info.size, modifiedAt: info.mtime.toISOString() }); }
      }
    };
    await visit(root, relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''), 0);
    return { root: desktopWorkspaceRoot, entries: output };
  });
  ipcMain.handle('tanva:workspace:read', async (event, relativePath) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted workspace request');
    const target = resolveWorkspacePath(relativePath);
    const info = await stat(target);
    if (!info.isFile()) throw new Error('只能读取文件');
    if (info.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB，请通过附件上传');
    const content = await readFile(target, 'utf8');
    return { path: relativePath, size: info.size, content };
  });
  ipcMain.handle('tanva:workspace:write', async (event, relativePath, content) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted workspace request');
    if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) throw new Error('写入内容超过 2MB');
    const target = resolveWorkspacePath(relativePath);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const answer = await dialog.showMessageBox(owner, { type: 'question', buttons: ['写入文件', '取消'], defaultId: 1, cancelId: 1, title: '确认写入工作文件夹', message: `允许写入 ${relativePath} 吗？` });
    if (answer.response !== 0) return { written: false, cancelled: true };
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    return { written: true, path: relativePath, size: Buffer.byteLength(content) };
  });
  ipcMain.handle('tanva:workspace:reveal', async (event, relativePath = '') => {
    if (!isTrustedSender(event)) throw new Error('Untrusted workspace request');
    const target = resolveWorkspacePath(relativePath);
    shell.showItemInFolder(target);
    return { ok: true };
  });
  ipcMain.handle('tanva:codex:thread-start', async (event, params = {}) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted Codex request');
    return localCodex.startThread({ ...params, ephemeral: params.ephemeral !== false });
  });
  ipcMain.handle('tanva:codex:thread-resume', async (event, params = {}) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted Codex request');
    return localCodex.resumeThread(params);
  });
  ipcMain.handle('tanva:codex:turn-start', async (event, params = {}) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted Codex request');
    return localCodex.startTurn(params);
  });
  ipcMain.handle('tanva:screen:capture', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted screenshot request');
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) throw new Error('Window unavailable');
    const image = await owner.webContents.capturePage();
    const output = join(app.getPath('temp'), `tanva-screenshot-${Date.now()}.png`);
    await writeFile(output, image.toPNG(), { mode: 0o600 });
    return { path: output, width: image.getSize().width, height: image.getSize().height };
  });
  ipcMain.handle('tanva:update:check', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted update request');
    const manifestUrl = process.env.TANVA_UPDATE_MANIFEST_URL?.trim();
    const currentVersion = app.getVersion();
    if (!manifestUrl) return { status: 'unconfigured', currentVersion };
    let url;
    try { url = new URL(manifestUrl); } catch { throw new Error('更新地址无效'); }
    if (url.protocol !== 'https:') throw new Error('更新地址必须使用 HTTPS');
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`更新检查失败（${response.status}）`);
    const manifest = await response.json();
    const latestVersion = typeof manifest?.version === 'string' ? manifest.version : null;
    return { status: latestVersion && latestVersion !== currentVersion ? 'available' : 'up-to-date', currentVersion, latestVersion, releaseUrl: typeof manifest?.url === 'string' ? manifest.url : null };
  });
};

const getConnectorSettingsPath = () => join(app.getPath('userData'), 'connectors.json');

const readConnectorSettings = async () => {
  try {
    const parsed = parseJsonDocument(await readFile(getConnectorSettingsPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeConnectorSettings = async (settings) => {
  const settingsPath = getConnectorSettingsPath();
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
};

const getWindowsProgramRoots = () =>
  [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);

const discoverConnectorPath = (definition) => {
  const candidates = definition[process.platform] || [];
  if (process.platform !== 'win32') {
    return candidates.find((candidate) => existsSync(candidate)) || null;
  }
  for (const root of getWindowsProgramRoots()) {
    for (const candidate of candidates) {
      const fullPath = join(root, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }
  return null;
};

const resolveConnectors = async () => {
  const settings = await readConnectorSettings();
  return Object.entries(connectorDefinitions).map(([id, definition]) => {
    if (definition.internal) {
      return {
        id, name: definition.name, hostedBy: null, internal: true, available: true, source: 'configured',
        transport: 'connected', protocol: 'stdio',
        toolCount: (constructionToolDefinitions[id] || []).length, error: null,
      };
    }
    const configuredPath = typeof settings[id] === 'string' ? settings[id] : null;
    const validConfiguredPath = configuredPath && existsSync(configuredPath) ? configuredPath : null;
    const executablePath = validConfiguredPath || discoverConnectorPath(definition);
    const savedMcpConfig = settings.mcpServers?.[id]
      ? resolveMcpConfigPlaceholders(settings.mcpServers[id], desktopRuntimePaths)
      : null;
    const bundledMcpConfig = getBundledMcpConfig(id, desktopRuntimePaths, process.platform, executablePath);
    const effectiveMcpConfig = savedMcpConfig ||
      (isBundledMcpConfigAvailable(bundledMcpConfig) ? bundledMcpConfig : null);
    const mcpStatus = capabilityHost.getStatus(
      id,
      Boolean(effectiveMcpConfig),
      effectiveMcpConfig?.type === 'sse' || effectiveMcpConfig?.type === 'streamable-http'
        ? effectiveMcpConfig.type
        : 'stdio'
    );
    return {
      id,
      name: definition.name,
      hostedBy: definition.hostedBy || null,
      internal: false,
      available: Boolean(executablePath),
      source: validConfiguredPath ? 'configured' : executablePath ? 'discovered' : 'missing',
      executablePath,
      ...mcpStatus,
    };
  });
};

const getMcpConfigFromDocument = (document, connectorId) => {
  return resolveMcpConfigPlaceholders(
    selectMcpServer(document, connectorId),
    desktopRuntimePaths
  );
};

const redactToolArguments = (value, depth = 0) => {
  if (depth > 4) return '[depth-limited]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactToolArguments(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).slice(0, 40).map(([key, item]) => [
      key,
      /(token|key|secret|password|credential)/i.test(key)
        ? '[redacted]'
        : redactToolArguments(item, depth + 1),
    ])
  );
};

const toolRiskLabel = Object.freeze({
  read: '只读',
  write: '写入',
  destructive: '破坏性',
  script: '脚本执行',
});

const installConnectorIpc = () => {
  ipcMain.handle('tanva:connectors:list', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    return (await resolveConnectors()).map(({ executablePath: _executablePath, ...status }) => status);
  });
  ipcMain.handle('tanva:connectors:configure', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    const definition = connectorDefinitions[connectorId];
    if (!definition) throw new Error('Unknown connector');
    if (definition.internal) return false;
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: `选择 ${definition.name} 应用`,
      properties: ['openFile'],
      filters: process.platform === 'win32'
        ? [{ name: '应用程序', extensions: ['exe'] }]
        : undefined,
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const selectedPath = resolve(result.filePaths[0]);
    if (!existsSync(selectedPath)) throw new Error('Selected application no longer exists');
    if (process.platform === 'darwin' && !selectedPath.toLowerCase().endsWith('.app')) {
      throw new Error('请选择 macOS 应用程序（.app）');
    }
    if (process.platform === 'win32' && !selectedPath.toLowerCase().endsWith('.exe')) {
      throw new Error('请选择 Windows 应用程序（.exe）');
    }
    const settings = await readConnectorSettings();
    settings[connectorId] = selectedPath;
    await writeConnectorSettings(settings);
    return true;
  });
  ipcMain.handle('tanva:connectors:launch', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    if (!connectorDefinitions[connectorId]) throw new Error('Unknown connector');
    if (connectorDefinitions[connectorId].internal) return { ok: false, error: '这是 Tanva 内置工程能力，不需要启动外部应用' };
    const connector = (await resolveConnectors()).find((item) => item.id === connectorId);
    if (!connector?.executablePath) return { ok: false, error: '应用尚未安装或配置' };
    const error = await shell.openPath(connector.executablePath);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle('tanva:connectors:configure-mcp', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    const definition = connectorDefinitions[connectorId];
    if (!definition) throw new Error('Unknown connector');
    if (definition.internal) return { transport: 'connected', protocol: 'stdio', toolCount: (constructionToolDefinitions[connectorId] || []).length, error: null };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: `导入 ${definition.name} 的 MCP 配置`,
      properties: ['openFile'],
      filters: [{ name: 'MCP JSON 配置', extensions: ['json'] }],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const raw = await readFile(result.filePaths[0], 'utf8');
    if (raw.length > 128 * 1024) throw new Error('MCP 配置文件过大');
    const config = validateMcpServerConfig(
      getMcpConfigFromDocument(parseJsonDocument(raw), connectorId)
    );
    if (config.type === 'stdio') {
      if (!existsSync(config.command)) throw new Error('MCP command 不存在');
      if (config.cwd && !existsSync(config.cwd)) throw new Error('MCP cwd 不存在');
    }
    const connectionTarget = config.type === 'stdio'
      ? `程序：${config.command}\n参数：${config.args.join(' ').slice(0, 2_000)}${config.cwd ? `\n工作目录：${config.cwd}` : ''}`
      : `传输：${config.type === 'sse' ? 'SSE' : 'Streamable HTTP'}\n地址：${config.url}`;
    const confirmationOptions = {
      type: 'warning',
      buttons: ['取消', '连接并启动'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '确认启动本机 MCP 服务',
      message: `允许 Tanva 连接 ${definition.name} 的 MCP 服务？`,
      detail: `${connectionTarget}\n\n工具执行仍会逐次询问。`,
    };
    const confirmation = owner
      ? await dialog.showMessageBox(owner, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions);
    if (confirmation.response !== 1) return null;
    const status = await capabilityHost.connect(connectorId, config);
    const settings = await readConnectorSettings();
    settings.mcpServers = {
      ...(settings.mcpServers && typeof settings.mcpServers === 'object'
        ? settings.mcpServers
        : {}),
      [connectorId]: config,
    };
    await writeConnectorSettings(settings);
    return status;
  });
  ipcMain.handle('tanva:connectors:connect-mcp', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    if (!connectorDefinitions[connectorId]) throw new Error('Unknown connector');
    if (connectorDefinitions[connectorId].internal) {
      return { transport: 'connected', protocol: 'stdio', toolCount: (constructionToolDefinitions[connectorId] || []).length, error: null };
    }
    const settings = await readConnectorSettings();
    const savedConfig = settings.mcpServers?.[connectorId]
      ? resolveMcpConfigPlaceholders(settings.mcpServers[connectorId], desktopRuntimePaths)
      : null;
    const bundledConfig = getBundledMcpConfig(connectorId, desktopRuntimePaths, process.platform, discoverConnectorPath(connectorDefinitions[connectorId]));
    const config = savedConfig ||
      (isBundledMcpConfigAvailable(bundledConfig) ? bundledConfig : null);
    if (!config) throw new Error('尚未导入 MCP 配置');
    return capabilityHost.connect(connectorId, config);
  });
  ipcMain.handle('tanva:connectors:connect-mcp-url', async (event, connectorId, rawConfig) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    const definition = connectorDefinitions[connectorId];
    if (!definition) throw new Error('Unknown connector');
    if (definition.internal) return { transport: 'connected', protocol: 'stdio', toolCount: (constructionToolDefinitions[connectorId] || []).length, error: null };
    const config = validateMcpServerConfig(rawConfig);
    if (config.type !== 'sse' && config.type !== 'streamable-http') {
      throw new Error('本机地址连接只支持 HTTP MCP');
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const confirmationOptions = {
      type: 'warning',
      buttons: ['取消', '连接并启动'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '确认连接 MCP 地址',
      message: `允许 Tanva 连接 ${definition.name} 的 MCP 服务？`,
      detail: `传输：${config.type === 'sse' ? 'SSE' : 'Streamable HTTP'}\n地址：${config.url}\n\n工具执行仍会逐次询问。`,
    };
    const confirmation = owner
      ? await dialog.showMessageBox(owner, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions);
    if (confirmation.response !== 1) return null;
    const status = await capabilityHost.connect(connectorId, config);
    const settings = await readConnectorSettings();
    settings.mcpServers = {
      ...(settings.mcpServers && typeof settings.mcpServers === 'object' ? settings.mcpServers : {}),
      [connectorId]: config,
    };
    await writeConnectorSettings(settings);
    return status;
  });
  ipcMain.handle('tanva:connectors:disconnect-mcp', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    if (!connectorDefinitions[connectorId]) throw new Error('Unknown connector');
    if (connectorDefinitions[connectorId].internal) {
      return { transport: 'connected', protocol: 'stdio', toolCount: (constructionToolDefinitions[connectorId] || []).length, error: null };
    }
    await capabilityHost.disconnect(connectorId);
    const settings = await readConnectorSettings();
    const savedConfig = settings.mcpServers?.[connectorId]
      ? resolveMcpConfigPlaceholders(settings.mcpServers[connectorId], desktopRuntimePaths)
      : null;
    const bundledConfig = getBundledMcpConfig(connectorId, desktopRuntimePaths);
    const effectiveConfig = savedConfig ||
      (isBundledMcpConfigAvailable(bundledConfig) ? bundledConfig : null);
    const configuredProtocol = effectiveConfig?.type === 'sse' ||
      effectiveConfig?.type === 'streamable-http'
      ? effectiveConfig.type
      : 'stdio';
    return capabilityHost.getStatus(connectorId, Boolean(effectiveConfig), configuredProtocol);
  });
  ipcMain.handle('tanva:connectors:list-tools', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    if (!connectorDefinitions[connectorId]) throw new Error('Unknown connector');
    return connectorDefinitions[connectorId].internal
      ? constructionHost.listTools(connectorId)
      : capabilityHost.listTools(connectorId);
  });
  ipcMain.handle('tanva:connectors:call-tool', async (event, connectorId, toolName, args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    const definition = connectorDefinitions[connectorId];
    if (!definition) throw new Error('Unknown connector');
    const internal = connectorDefinitions[connectorId].internal;
    const tool = (internal ? await constructionHost.listTools(connectorId) : capabilityHost.listTools(connectorId))
      .find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error('MCP 工具不存在或尚未连接');
    // Reject malformed arguments before showing a native approval prompt. This
    // keeps the confirmation dialog meaningful and avoids approving a call that
    // the MCP server will reject immediately.
    validateToolArguments(tool.inputSchema, args);
    const encodedArgs = JSON.stringify(args || {});
    if (encodedArgs.length > 64 * 1024) throw new Error('MCP 工具参数过大');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const detail = JSON.stringify(redactToolArguments(args), null, 2).slice(0, 4_000);
    const options = {
      type: tool.risk === 'read' ? 'info' : 'warning',
      buttons: ['取消', '允许一次'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '小T请求调用本机工具',
      message: `允许小T调用 ${definition.name} 的 ${tool.name}？`,
      detail: `风险级别：${toolRiskLabel[tool.risk] || tool.risk}\n\n参数摘要：\n${detail}`,
    };
    const approval = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (approval.response !== 1) return { approved: false, cancelled: true };
    const result = await computeUse({
      host: internal ? constructionHost : capabilityHost,
      connectorId,
      toolName,
      args,
      action: isComputeUseAction(connectorId, toolName) ? toolName : null,
      taskId: event.sender.id ? String(event.sender.id) : null,
    });
    return { approved: true, cancelled: false, ...result };
  });
};

const sendMaximizedState = (window) => {
  window.webContents.send('tanva:window:maximized-changed', window.isMaximized());
};

const installWindowIpc = () => {
  ipcMain.handle('tanva:window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle('tanva:window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('tanva:window:close', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false;
    void quitCoordinator.requestQuit();
    return true;
  });
  ipcMain.handle('tanva:window:is-maximized', (event) =>
    BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  );
};

const createMainWindow = async () => {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    // Show the native shell immediately. Large renderer bundles and first-run
    // WebView initialization can delay ready-to-show; keeping the window
    // hidden until then makes the packaged app appear to be hung.
    show: true,
    backgroundColor: '#ffffff',
    title: 'Tanva',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
    autoHideMenuBar: process.platform !== 'darwin',
    ...(app.isPackaged ? {} : { icon: join(frontendRoot, 'public', 'logo.png') }),
    webPreferences: {
      preload: join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  window.webContents.on('will-prevent-unload', (event) => {
    if (!quitCoordinator.isQuitPending()) return;
    // Browser-style beforeunload dialogs can become invisible sheets while
    // Electron is quitting. Desktop state is autosaved, so an explicit app
    // quit must never leave a headless main process behind.
    event.preventDefault();
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(
      `[tanva-renderer] load failed code=${errorCode} description=${errorDescription} url=${validatedUrl}`
    );
  });

  window.webContents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return;
    console.error(
      `[tanva-renderer] ${details.sourceId}:${details.lineNumber} ${details.message}`
    );
  });

  window.on('maximize', () => sendMaximizedState(window));
  window.on('unmaximize', () => sendMaximizedState(window));
  window.once('ready-to-show', () => {
    window.show();
    window.focus();
  });
  window.on('close', (event) => {
    if (quitCoordinator.isReadyToQuit()) return;
    event.preventDefault();
    void quitCoordinator.requestQuit();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  if (process.env.TANVA_ELECTRON_SMOKE === '1') {
    window.webContents.once('did-finish-load', async () => {
      const smoke = await window.webContents.executeJavaScript(`(async () => {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const root = document.getElementById('root');
        const appImages = Array.from(document.images).filter((element) => {
          try {
            return new URL(element.currentSrc || element.src).protocol === 'file:';
          } catch {
            return false;
          }
        });
        await Promise.all(appImages.map((element) => {
          if (element.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const settle = () => resolve();
            element.addEventListener('load', settle, { once: true });
            element.addEventListener('error', settle, { once: true });
            setTimeout(settle, 1500);
          });
        }));
        const brokenAppImageCount = appImages.filter(
          (element) => !element.complete || element.naturalWidth === 0
        ).length;
        const rendererReady = Boolean(
          window.tanvaDesktop?.isElectron &&
          root &&
          root.childElementCount > 0 &&
          root.textContent?.trim() &&
          brokenAppImageCount === 0
        );
        const connectors = await window.tanvaDesktop?.connectors?.list?.();
        return {
          rendererReady,
          connectorCount: Array.isArray(connectors) ? connectors.length : 0,
          brokenAppImageCount,
        };
      })()`);
      console.log(
        `[tanva-smoke] renderer-ready=${smoke.rendererReady} connector-count=${smoke.connectorCount} broken-app-images=${smoke.brokenAppImageCount}`
      );
      app.exit(smoke.rendererReady && smoke.connectorCount === Object.keys(connectorDefinitions).length ? 0 : 1);
    });
  }

  if (devRendererUrl) {
    const url = new URL(devRendererUrl);
    url.searchParams.set('desktop', '1');
    await window.loadURL(url.toString());
    if (process.env.TANVA_ELECTRON_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await window.loadURL(
      `${pathToFileURL(join(
        app.isPackaged ? getPackagedRendererRoot() : resolve(frontendRoot, 'dist'),
        'index.html'
      )).toString()}?desktop=1`
    );
  }

  return window;
};

app.whenReady().then(async () => {
  installWindowIpc();
  installConnectorIpc();
  installAuthSessionIpc();
  installClipboardIpc();
  installExternalTargetIpc();
  installDesktopCapabilityIpc();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = isTrustedAppUrl(webContents.getURL());
    const mediaRequest =
      permission === 'media' &&
      Array.isArray(details.mediaTypes) &&
      details.mediaTypes.every((type) => type === 'audio' || type === 'video');
    callback(Boolean(trusted && mediaRequest));
  });

  mainWindow = await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = await createMainWindow();
  });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  void quitCoordinator.requestQuit();
});

app.on('before-quit', (event) => {
  if (quitCoordinator.isReadyToQuit()) return;
  event.preventDefault();
  void quitCoordinator.requestQuit();
});
