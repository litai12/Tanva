export type ProjectContentHistoryState<Content> = {
  projectId: string | null;
  content: Content | null;
  dirty: boolean;
  dirtySince: number | null;
  dirtyCounter: number;
  lastError: string | null;
};

export function restoreProjectHistoryState<
  Content,
  State extends ProjectContentHistoryState<Content>,
>(state: State, content: Content, now = Date.now()): State {
  if (!state.projectId) return state;

  return {
    ...state,
    content,
    dirty: true,
    dirtySince: state.dirtySince ?? now,
    dirtyCounter: state.dirtyCounter + 1,
    lastError: null,
  };
}
