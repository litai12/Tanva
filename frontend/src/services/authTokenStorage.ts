const LS_ACCESS_TOKEN = "access_token";
const LS_REFRESH_TOKEN = "refresh_token";

let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;
let initialized = false;

export type AuthTokens = {
  accessToken?: string | null;
  refreshToken?: string | null;
};

const readLegacyToken = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const removeLegacyTokens = () => {
  try {
    localStorage.removeItem(LS_ACCESS_TOKEN);
    localStorage.removeItem(LS_REFRESH_TOKEN);
  } catch {}
};

const persistBrowserTokens = () => {
  try {
    if (memoryAccessToken) localStorage.setItem(LS_ACCESS_TOKEN, memoryAccessToken);
    else localStorage.removeItem(LS_ACCESS_TOKEN);
    if (memoryRefreshToken) localStorage.setItem(LS_REFRESH_TOKEN, memoryRefreshToken);
    else localStorage.removeItem(LS_REFRESH_TOKEN);
  } catch {}
};

const persistDesktopTokens = () => {
  const desktopAuth = window.tanvaDesktop?.auth;
  if (!desktopAuth) return;
  removeLegacyTokens();
  if (!memoryAccessToken && !memoryRefreshToken) {
    void desktopAuth.clear().catch(() => {});
    return;
  }
  void desktopAuth
    .write({
      accessToken: memoryAccessToken || "",
      refreshToken: memoryRefreshToken || "",
    })
    .then((saved) => {
      // 极少数 Linux 环境没有系统密钥环；此时回退到原有网页存储，
      // 仍优先保证用户不需要每次重登。
      if (!saved) persistBrowserTokens();
    })
    .catch(() => persistBrowserTokens());
};

/**
 * Electron 启动时先从系统加密存储恢复令牌，再挂载 React。
 * 首次升级会把旧 localStorage 令牌无感迁移到系统密钥存储。
 */
export async function initializeAuthTokenStorage(): Promise<void> {
  if (initialized) return;
  const legacyAccessToken = readLegacyToken(LS_ACCESS_TOKEN);
  const legacyRefreshToken = readLegacyToken(LS_REFRESH_TOKEN);
  const desktopAuth = window.tanvaDesktop?.auth;

  if (!desktopAuth) {
    memoryAccessToken = legacyAccessToken;
    memoryRefreshToken = legacyRefreshToken;
    initialized = true;
    return;
  }

  try {
    const stored = await desktopAuth.read();
    if (stored.tokens) {
      memoryAccessToken = stored.tokens.accessToken || null;
      memoryRefreshToken = stored.tokens.refreshToken || null;
      removeLegacyTokens();
    } else {
      memoryAccessToken = legacyAccessToken;
      memoryRefreshToken = legacyRefreshToken;
      if (stored.available && (legacyAccessToken || legacyRefreshToken)) {
        const migrated = await desktopAuth.write({
          accessToken: legacyAccessToken || "",
          refreshToken: legacyRefreshToken || "",
        });
        if (migrated) removeLegacyTokens();
      }
    }
  } catch {
    memoryAccessToken = legacyAccessToken;
    memoryRefreshToken = legacyRefreshToken;
  }
  initialized = true;
}

export function getAccessToken(): string | null {
  return memoryAccessToken ?? readLegacyToken(LS_ACCESS_TOKEN);
}

export function getRefreshToken(): string | null {
  return memoryRefreshToken ?? readLegacyToken(LS_REFRESH_TOKEN);
}

export function setTokens(tokens: AuthTokens) {
  if (typeof tokens.accessToken === "string") {
    memoryAccessToken = tokens.accessToken || null;
  }
  if (typeof tokens.refreshToken === "string") {
    memoryRefreshToken = tokens.refreshToken || null;
  }
  if (window.tanvaDesktop?.auth) persistDesktopTokens();
  else persistBrowserTokens();
}

export function clearTokens() {
  memoryAccessToken = null;
  memoryRefreshToken = null;
  removeLegacyTokens();
  if (window.tanvaDesktop?.auth) {
    void window.tanvaDesktop.auth.clear().catch(() => {});
  }
}

export function getAccessAuthHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getRefreshAuthHeader(): Record<string, string> {
  const token = getRefreshToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
