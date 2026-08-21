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
      connectors: Readonly<{
        list: () => Promise<DesktopConnectorStatus[]>;
        configure: (connectorId: string) => Promise<boolean | null>;
        launch: (connectorId: string) => Promise<{ ok: boolean; error?: string }>;
        configureMcp: (connectorId: string) => Promise<DesktopMcpStatus | null>;
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
    available: boolean;
    source: 'configured' | 'discovered' | 'missing';
    transport: DesktopMcpTransportStatus;
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
    toolCount: number;
    error: string | null;
  }

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
