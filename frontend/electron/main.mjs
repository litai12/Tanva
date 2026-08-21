import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DesktopCapabilityHost,
  validateStdioServerConfig,
} from './capability-host.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(currentDir, '..');
const devRendererUrl = process.env.ELECTRON_RENDERER_URL?.trim() || null;
const trustedDevOrigin = devRendererUrl ? new URL(devRendererUrl).origin : null;

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
});

app.setName('Tanva');
app.setAppUserModelId('com.tanva.desktop');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
const capabilityHost = new DesktopCapabilityHost();

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

const getConnectorSettingsPath = () => join(app.getPath('userData'), 'connectors.json');

const readConnectorSettings = async () => {
  try {
    const parsed = JSON.parse(await readFile(getConnectorSettingsPath(), 'utf8'));
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
    const configuredPath = typeof settings[id] === 'string' ? settings[id] : null;
    const validConfiguredPath = configuredPath && existsSync(configuredPath) ? configuredPath : null;
    const executablePath = validConfiguredPath || discoverConnectorPath(definition);
    const mcpStatus = capabilityHost.getStatus(
      id,
      Boolean(settings.mcpServers?.[id])
    );
    return {
      id,
      name: definition.name,
      hostedBy: definition.hostedBy || null,
      available: Boolean(executablePath),
      source: validConfiguredPath ? 'configured' : executablePath ? 'discovered' : 'missing',
      executablePath,
      ...mcpStatus,
    };
  });
};

const getMcpConfigFromDocument = (document, connectorId) => {
  if (!document || typeof document !== 'object') throw new Error('MCP 配置文件不是有效对象');
  const candidate = document.mcpServers?.[connectorId] || document;
  if (candidate?.type && candidate.type !== 'stdio') {
    throw new Error('当前版本只接受 stdio MCP 配置');
  }
  return candidate;
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
    const connector = (await resolveConnectors()).find((item) => item.id === connectorId);
    if (!connector?.executablePath) return { ok: false, error: '应用尚未安装或配置' };
    const error = await shell.openPath(connector.executablePath);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle('tanva:connectors:configure-mcp', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    const definition = connectorDefinitions[connectorId];
    if (!definition) throw new Error('Unknown connector');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: `导入 ${definition.name} 的 stdio MCP 配置`,
      properties: ['openFile'],
      filters: [{ name: 'MCP JSON 配置', extensions: ['json'] }],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const raw = await readFile(result.filePaths[0], 'utf8');
    if (raw.length > 128 * 1024) throw new Error('MCP 配置文件过大');
    const config = validateStdioServerConfig(
      getMcpConfigFromDocument(JSON.parse(raw), connectorId)
    );
    if (!existsSync(config.command)) throw new Error('MCP command 不存在');
    if (config.cwd && !existsSync(config.cwd)) throw new Error('MCP cwd 不存在');
    const confirmationOptions = {
      type: 'warning',
      buttons: ['取消', '连接并启动'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '确认启动本机 MCP 服务',
      message: `允许 Tanva 启动 ${definition.name} 的 MCP 服务？`,
      detail: `程序：${config.command}\n参数：${config.args.join(' ').slice(0, 2_000)}${config.cwd ? `\n工作目录：${config.cwd}` : ''}\n\n服务将作为本机子进程运行。工具执行仍会逐次询问。`,
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
    const settings = await readConnectorSettings();
    const config = settings.mcpServers?.[connectorId];
    if (!config) throw new Error('尚未导入 MCP 配置');
    return capabilityHost.connect(connectorId, config);
  });
  ipcMain.handle('tanva:connectors:disconnect-mcp', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    if (!connectorDefinitions[connectorId]) throw new Error('Unknown connector');
    await capabilityHost.disconnect(connectorId);
    return capabilityHost.getStatus(connectorId, true);
  });
  ipcMain.handle('tanva:connectors:list-tools', async (event, connectorId) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    if (!connectorDefinitions[connectorId]) throw new Error('Unknown connector');
    return capabilityHost.listTools(connectorId);
  });
  ipcMain.handle('tanva:connectors:call-tool', async (event, connectorId, toolName, args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted connector request');
    const definition = connectorDefinitions[connectorId];
    if (!definition) throw new Error('Unknown connector');
    const tool = capabilityHost
      .listTools(connectorId)
      .find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error('MCP 工具不存在或尚未连接');
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
    const execution = await capabilityHost.callTool(connectorId, toolName, args);
    return { approved: true, cancelled: false, ...execution.result };
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
    BrowserWindow.fromWebContents(event.sender)?.close();
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
    show: false,
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
  window.once('ready-to-show', () => window.show());
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
      app.exit(smoke.rendererReady && smoke.connectorCount === 5 ? 0 : 1);
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
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void capabilityHost.disconnectAll();
});
