/** Only the desktop authorization page may request a full document redirect. */
export function desktopLoginReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/api/auth/desktop/authorize?')) return null;
  try {
    const url = new URL(raw, 'https://tanvas.cn');
    if (url.origin !== 'https://tanvas.cn' || url.pathname !== '/api/auth/desktop/authorize' || url.hash
      || url.searchParams.getAll('sessionId').length !== 1
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('sessionId') || '')
      || [...url.searchParams.keys()].some(key => key !== 'sessionId')) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}
