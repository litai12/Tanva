const LS_ACCESS_TOKEN = "access_token";
const LS_REFRESH_TOKEN = "refresh_token";

export type AuthTokens = {
  accessToken?: string | null;
  refreshToken?: string | null;
};

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(LS_ACCESS_TOKEN);
  } catch {
    return null;
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(LS_REFRESH_TOKEN);
  } catch {
    return null;
  }
}

export function setTokens(tokens: AuthTokens) {
  try {
    if (typeof tokens.accessToken === "string") {
      localStorage.setItem(LS_ACCESS_TOKEN, tokens.accessToken);
    }
    if (typeof tokens.refreshToken === "string") {
      localStorage.setItem(LS_REFRESH_TOKEN, tokens.refreshToken);
    }
  } catch {}
}

export function clearTokens() {
  try {
    localStorage.removeItem(LS_ACCESS_TOKEN);
    localStorage.removeItem(LS_REFRESH_TOKEN);
  } catch {}
}

export function getAccessAuthHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getRefreshAuthHeader(): Record<string, string> {
  const token = getRefreshToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
