import { useCallback, useEffect, useState } from 'react';
import {
  AppWindow,
  CheckCircle2,
  ExternalLink,
  FileJson,
  FolderCog,
  PlugZap,
  RefreshCw,
  Unplug,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const statusText = (connector: DesktopConnectorStatus): string => {
  if (!connector.available) return '未找到应用';
  return connector.source === 'configured' ? '已手动配置' : '已自动检测';
};

const mcpStatusText = (connector: DesktopConnectorStatus): string => {
  if (connector.transport === 'connected') return `MCP 已连接 · ${connector.toolCount} 个工具`;
  if (connector.transport === 'connecting') return 'MCP 连接中';
  if (connector.transport === 'configured') return 'MCP 已配置';
  if (connector.transport === 'error') return 'MCP 连接失败';
  return 'MCP 未配置';
};

export default function DesktopConnectorsSurface() {
  const desktopBridge = window.tanvaDesktop;
  const [connectors, setConnectors] = useState<DesktopConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedToolsId, setExpandedToolsId] = useState<string | null>(null);
  const [toolsByConnector, setToolsByConnector] = useState<Record<string, DesktopMcpTool[]>>({});

  const refresh = useCallback(async () => {
    if (!desktopBridge?.connectors) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setConnectors(await desktopBridge.connectors.list());
    } finally {
      setLoading(false);
    }
  }, [desktopBridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configure = async (connectorId: string) => {
    if (!desktopBridge?.connectors) return;
    setBusyId(connectorId);
    setNotice(null);
    try {
      const configured = await desktopBridge.connectors.configure(connectorId);
      if (configured) await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '配置失败');
    } finally {
      setBusyId(null);
    }
  };

  const launch = async (connector: DesktopConnectorStatus) => {
    if (!desktopBridge?.connectors) return;
    setBusyId(connector.id);
    setNotice(null);
    try {
      const result = await desktopBridge.connectors.launch(connector.id);
      setNotice(result.ok ? `已启动 ${connector.name}` : result.error || '启动失败');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '启动失败');
    } finally {
      setBusyId(null);
    }
  };

  const configureMcp = async (connector: DesktopConnectorStatus) => {
    if (!desktopBridge?.connectors) return;
    setBusyId(connector.id);
    setNotice(null);
    try {
      const status = await desktopBridge.connectors.configureMcp(connector.id);
      if (status?.error) setNotice(status.error);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'MCP 配置失败');
    } finally {
      setBusyId(null);
    }
  };

  const toggleMcp = async (connector: DesktopConnectorStatus) => {
    if (!desktopBridge?.connectors) return;
    setBusyId(connector.id);
    setNotice(null);
    try {
      const status = connector.transport === 'connected'
        ? await desktopBridge.connectors.disconnectMcp(connector.id)
        : await desktopBridge.connectors.connectMcp(connector.id);
      if (status.error) setNotice(status.error);
      if (status.transport !== 'connected') setExpandedToolsId(null);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'MCP 操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const toggleTools = async (connector: DesktopConnectorStatus) => {
    if (!desktopBridge?.connectors || connector.transport !== 'connected') return;
    if (expandedToolsId === connector.id) {
      setExpandedToolsId(null);
      return;
    }
    const tools = await desktopBridge.connectors.listTools(connector.id);
    setToolsByConnector((current) => ({ ...current, [connector.id]: tools }));
    setExpandedToolsId(connector.id);
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50/60 p-5">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">小T的本机应用</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              检测和启动专业应用，并连接用户明确导入的 stdio MCP 服务。当前只发现工具，不执行工具；写入与脚本类调用要等风险分级和逐次授权完成后开放。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-8 flex-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-950 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            重新检测
          </button>
        </div>

        {!desktopBridge && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            本机应用连接只在 Tanva 桌面版中可用。
          </div>
        )}

        {notice && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            {notice}
          </div>
        )}

        <div className="mt-5 space-y-2">
          {connectors.map((connector) => (
            <article key={connector.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <AppWindow className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{connector.name}</h3>
                    {connector.available && <CheckCircle2 className="h-3.5 w-3.5 flex-none text-emerald-600" />}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">
                    {statusText(connector)}
                    {connector.hostedBy ? ` · 由 ${connector.hostedBy === 'rhino' ? 'Rhino' : connector.hostedBy} 承载` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void configure(connector.id)}
                  disabled={busyId === connector.id || !desktopBridge}
                  className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50"
                >
                  <FolderCog className="h-3.5 w-3.5" />
                  选择应用
                </button>
                <button
                  type="button"
                  onClick={() => void launch(connector)}
                  disabled={!connector.available || busyId === connector.id || !desktopBridge}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  启动
                </button>
              </div>

              <div className="ml-[52px] mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
                <span className={cn(
                  'min-w-0 flex-1 truncate text-[11px]',
                  connector.transport === 'connected' ? 'text-emerald-700' :
                    connector.transport === 'error' ? 'text-red-600' : 'text-slate-500'
                )}>
                  {mcpStatusText(connector)}
                </span>
                {connector.transport === 'connected' && (
                  <button type="button" onClick={() => void toggleTools(connector)} className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-slate-600 hover:bg-slate-100">
                    <Wrench className="h-3 w-3" />
                    工具
                  </button>
                )}
                <button type="button" onClick={() => void configureMcp(connector)} disabled={busyId === connector.id || !desktopBridge} className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                  <FileJson className="h-3 w-3" />
                  导入 MCP
                </button>
                {connector.transport !== 'not-configured' && (
                  <button type="button" onClick={() => void toggleMcp(connector)} disabled={busyId === connector.id || connector.transport === 'connecting' || !desktopBridge} className="flex h-7 items-center gap-1 rounded-md bg-blue-50 px-2 text-[10px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                    {connector.transport === 'connected' ? <Unplug className="h-3 w-3" /> : <PlugZap className="h-3 w-3" />}
                    {connector.transport === 'connected' ? '断开' : '连接'}
                  </button>
                )}
              </div>

              {expandedToolsId === connector.id && (
                <div className="ml-[52px] mt-2 max-h-44 overflow-y-auto rounded-lg bg-slate-50 p-2">
                  {(toolsByConnector[connector.id] || []).map((tool) => (
                    <div key={tool.name} className="border-b border-slate-200/70 px-1 py-1.5 last:border-b-0">
                      <div className="font-mono text-[10px] font-semibold text-slate-800">{tool.name}</div>
                      {tool.description && <div className="mt-0.5 text-[10px] leading-4 text-slate-500">{tool.description}</div>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
          {!loading && desktopBridge && connectors.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              未能读取连接器状态，请重新检测。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
