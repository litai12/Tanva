// 同浏览器跨 tab 的项目版本广播：某 tab 保存成功后广播其新版本号，
// 其它落后 tab 据此即时冻结（不必等自己保存被后端拒绝）。
// 仅覆盖同源同浏览器多 tab（本特性主场景）；跨设备/跨浏览器由后端护栏在保存时兜底。
// BroadcastChannel 不可用时静默降级，不影响后端护栏与前端 staleContent 逻辑。

export type ProjectVersionMessage = { projectId: string; version: number };

const CHANNEL_NAME = 'tanva:project-version';
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

export const projectVersionChannel = {
  /** 本 tab 保存成功后调用，广播新版本号给其它 tab。 */
  postSaved(projectId: string, version: number): void {
    const c = getChannel();
    if (!c) return;
    try {
      c.postMessage({ projectId, version } as ProjectVersionMessage);
    } catch {
      // noop
    }
  },
  /** 订阅其它 tab 的保存广播；返回取消订阅函数。 */
  onRemoteSaved(cb: (msg: ProjectVersionMessage) => void): () => void {
    const c = getChannel();
    if (!c) return () => {};
    const handler = (e: MessageEvent) => {
      const data = e.data as ProjectVersionMessage | undefined;
      if (data && typeof data.projectId === 'string' && typeof data.version === 'number') {
        cb(data);
      }
    };
    c.addEventListener('message', handler);
    return () => c.removeEventListener('message', handler);
  },
};
