const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

export const resolveOriginHostname = (value: string): string => {
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return normalizeHostname(
      value.replace(/^https?:\/\//, "").split("/")[0].split(":")[0]
    );
  }
};

export const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
};

export const originsShareHost = (
  allowedOrigin: string,
  requestOrigin: string
): boolean => {
  if (allowedOrigin === requestOrigin) return true;

  const allowedHostname = resolveOriginHostname(allowedOrigin);
  const requestHostname = resolveOriginHostname(requestOrigin);
  if (allowedHostname === requestHostname) return true;

  return (
    isLoopbackHostname(allowedHostname) &&
    isLoopbackHostname(requestHostname)
  );
};
