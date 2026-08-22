const ABSOLUTE_OR_RUNTIME_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * Resolve a file from Vite's public directory in both website and packaged
 * Electron builds. Root-absolute `/asset.png` URLs point at the filesystem
 * root under file://, while Vite's BASE_URL is `./` for the desktop build.
 */
export const resolvePublicAssetUrl = (path: string, baseUrl: string): string => {
  const value = path.trim();
  if (!value || ABSOLUTE_OR_RUNTIME_URL.test(value)) return value;
  const relativePath = value.replace(/^\/+/, '');
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${relativePath}`;
};

export const publicAssetUrl = (path: string): string =>
  resolvePublicAssetUrl(
    path,
    (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/'
  );
