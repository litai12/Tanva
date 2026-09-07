const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => () => ipcRenderer.invoke(channel);

contextBridge.exposeInMainWorld(
  'tanvaDesktop',
  Object.freeze({
    isElectron: true,
    platform: process.platform,
    versions: Object.freeze({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    }),
    window: Object.freeze({
      minimize: invoke('tanva:window:minimize'),
      toggleMaximize: invoke('tanva:window:toggle-maximize'),
      close: invoke('tanva:window:close'),
      isMaximized: invoke('tanva:window:is-maximized'),
      onMaximizedChanged: (listener) => {
        if (typeof listener !== 'function') return () => {};
        const handler = (_event, isMaximized) => listener(Boolean(isMaximized));
        ipcRenderer.on('tanva:window:maximized-changed', handler);
        return () => ipcRenderer.removeListener('tanva:window:maximized-changed', handler);
      },
    }),
    auth: Object.freeze({
      read: () => ipcRenderer.invoke('tanva:auth:read'),
      write: (tokens) => ipcRenderer.invoke('tanva:auth:write', tokens),
      clear: () => ipcRenderer.invoke('tanva:auth:clear'),
    }),
    clipboard: Object.freeze({
      writeText: (text) => ipcRenderer.invoke('tanva:clipboard:write-text', text),
    }),
    openTarget: (target, kind = 'url') => ipcRenderer.invoke('tanva:open-target', { target, kind }),
    screen: Object.freeze({
      capture: () => ipcRenderer.invoke('tanva:screen:capture'),
    }),
    updates: Object.freeze({
      check: () => ipcRenderer.invoke('tanva:update:check'),
    }),
    workspace: Object.freeze({
      choose: () => ipcRenderer.invoke('tanva:workspace:choose'),
      status: () => ipcRenderer.invoke('tanva:workspace:status'),
      list: (relativePath) => ipcRenderer.invoke('tanva:workspace:list', relativePath || ''),
      read: (relativePath) => ipcRenderer.invoke('tanva:workspace:read', relativePath),
      write: (relativePath, content) => ipcRenderer.invoke('tanva:workspace:write', relativePath, content),
      reveal: (relativePath) => ipcRenderer.invoke('tanva:workspace:reveal', relativePath || ''),
    }),
    codex: Object.freeze({
      startThread: (params) => ipcRenderer.invoke('tanva:codex:thread-start', params),
      resumeThread: (params) => ipcRenderer.invoke('tanva:codex:thread-resume', params),
      startTurn: (params) => ipcRenderer.invoke('tanva:codex:turn-start', params),
    }),
    connectors: Object.freeze({
      list: () => ipcRenderer.invoke('tanva:connectors:list'),
      configure: (connectorId) => ipcRenderer.invoke('tanva:connectors:configure', connectorId),
      launch: (connectorId) => ipcRenderer.invoke('tanva:connectors:launch', connectorId),
      configureMcp: (connectorId) => ipcRenderer.invoke('tanva:connectors:configure-mcp', connectorId),
      connectMcpUrl: (connectorId, config) => ipcRenderer.invoke('tanva:connectors:connect-mcp-url', connectorId, config),
      connectMcp: (connectorId) => ipcRenderer.invoke('tanva:connectors:connect-mcp', connectorId),
      disconnectMcp: (connectorId) => ipcRenderer.invoke('tanva:connectors:disconnect-mcp', connectorId),
      listTools: (connectorId) => ipcRenderer.invoke('tanva:connectors:list-tools', connectorId),
      callTool: (connectorId, toolName, args) =>
        ipcRenderer.invoke('tanva:connectors:call-tool', connectorId, toolName, args),
    }),
  })
);
