export interface LocalCodexTurnResult {
  threadId?: string;
  turnId?: string;
  text: string;
}

/** Send one user turn to the Electron-hosted Codex app-server. */
export async function sendLocalCodexTurn(input: string, threadId?: string): Promise<LocalCodexTurnResult> {
  const bridge = window.tanvaDesktop?.codex;
  if (!bridge) throw new Error('本地 Codex 仅可在 Electron 中使用');
  const thread = threadId
    ? await bridge.resumeThread({ threadId })
    : await bridge.startThread({ ephemeral: false });
  const resolvedThreadId = String((thread as { thread?: { id?: string }; id?: string }).thread?.id ||
    (thread as { id?: string }).id || threadId || '');
  const turn = await bridge.startTurn({
    threadId: resolvedThreadId,
    input: [{ type: 'text', text: input }],
  });
  const text = typeof (turn as { text?: string }).text === 'string'
    ? (turn as { text: string }).text
    : 'Codex 已接收请求，正在执行。';
  return { threadId: resolvedThreadId || undefined, turnId: (turn as { turn?: { id?: string }; id?: string }).turn?.id || (turn as { id?: string }).id, text };
}
