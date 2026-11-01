/** Server-rendered grant pages allowed to receive a post-login full document redirect. */
const GRANT_PAGES: Record<string, string> = {
  '/api/auth/desktop/authorize': 'sessionId',
  '/api/oauth/consent': 'requestId',
};

/** Only the desktop / MCP OAuth authorization pages may request a full document redirect. */
export function desktopLoginReturnTo(raw: string | null): string | null {
  if (!raw || !Object.keys(GRANT_PAGES).some(path => raw.startsWith(`${path}?`))) return null;
  try {
    const url = new URL(raw, 'https://tanvas.cn');
    const param = GRANT_PAGES[url.pathname];
    if (url.origin !== 'https://tanvas.cn' || !param || url.hash
      || url.searchParams.getAll(param).length !== 1
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get(param) || '')
      || [...url.searchParams.keys()].some(key => key !== param)) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}
