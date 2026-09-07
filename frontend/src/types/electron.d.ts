export {};

declare global {
  interface Window {
    tanvaDesktop?: {
      isElectron: true;
      platform: NodeJS.Platform;
      versions: Readonly<{
        electron: string;
        chrome: string;
        node: string;
      }>;
      window: Readonly<{
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<boolean>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        onMaximizedChanged: (listener: (isMaximized: boolean) => void) => () => void;
      }>;
      auth: Readonly<{
        read: () => Promise<{
          available: boolean;
          tokens: { accessToken: string; refreshToken: string } | null;
        }>;
        write: (tokens: {
          accessToken: string;
          refreshToken: string;
        }) => Promise<boolean>;
        clear: () => Promise<boolean>;
      }>;
      clipboard: Readonly<{
        writeText: (text: string) => Promise<boolean>;
      }>;
      openTarget: (target: string, kind?: 'url' | 'path') => Promise<{ ok: boolean; error?: string }>;
      screen: Readonly<{
        capture: () => Promise<{ path: string; width: number; height: number }>;
      }>;
      updates: Readonly<{
        check: () => Promise<{
          status: 'unconfigured' | 'available' | 'up-to-date';
          currentVersion: string;
          latestVersion?: string | null;
          releaseUrl?: string | null;
        }>;
      }>;
      workspace: Readonly<{
        choose: () => Promise<{ selected: boolean; root: string | null }>;
        status: () => Promise<{ root: string | null }>;
        list: (relativePath?: string) => Promise<{ root: string; entries: Array<{ path: string; kind: 'file' | 'directory'; size?: number; modifiedAt?: string }> }>;
        read: (relativePath: string) => Promise<{ path: string; size: number; content: string }>;
        write: (relativePath: string, content: string) => Promise<{ written: boolean; cancelled?: boolean; path?: string; size?: number }>;
        reveal: (relativePath?: string) => Promise<{ ok: boolean }>;
      }>;
      codex: Readonly<{
        startThread: (params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
        resumeThread: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
        startTurn: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
      }>;
      connectors: Readonly<{
        list: () => Promise<DesktopConnectorStatus[]>;
        configure: (connectorId: string) => Promise<boolean | null>;
        launch: (connectorId: string) => Promise<{ ok: boolean; error?: string }>;
        configureMcp: (connectorId: string) => Promise<DesktopMcpStatus | null>;
        connectMcpUrl: (connectorId: string, config: { type: 'sse' | 'streamable-http'; url: string }) => Promise<DesktopMcpStatus | null>;
        connectMcp: (connectorId: string) => Promise<DesktopMcpStatus>;
        disconnectMcp: (connectorId: string) => Promise<DesktopMcpStatus>;
        listTools: (connectorId: string) => Promise<DesktopMcpTool[]>;
        callTool: (
          connectorId: string,
          toolName: string,
          args: Record<string, unknown>
        ) => Promise<DesktopMcpToolCallResult>;
      }>;
    };
  }

  interface DesktopConnectorStatus {
    id: string;
    name: string;
    hostedBy: string | null;
    internal?: boolean;
    available: boolean;
    source: 'configured' | 'discovered' | 'missing';
    transport: DesktopMcpTransportStatus;
    protocol: DesktopMcpProtocol;
    toolCount: number;
    error: string | null;
  }

  type DesktopMcpTransportStatus =
    | 'not-configured'
    | 'configured'
    | 'connecting'
    | 'connected'
    | 'error';

  interface DesktopMcpStatus {
    transport: DesktopMcpTransportStatus;
    protocol: DesktopMcpProtocol;
    toolCount: number;
    error: string | null;
  }

  type DesktopMcpProtocol = 'stdio' | 'streamable-http' | 'sse';

  interface DesktopMcpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    risk: 'read' | 'write' | 'destructive' | 'script';
  }

  interface DesktopMcpToolCallResult {
    approved: boolean;
    cancelled: boolean;
    isError?: boolean;
    text?: string;
    truncated?: boolean;
    omittedContentCount?: number;
  }
}
