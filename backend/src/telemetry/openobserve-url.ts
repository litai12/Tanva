const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const OPENOBSERVE_API_SEGMENT = '/api';
const OPENOBSERVE_UI_BASE_SEGMENT = '/openobserve';

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = stripTrailingSlash(baseUrl.trim());
  if (!trimmed) return trimmed;

  if (
    trimmed.endsWith(OPENOBSERVE_API_SEGMENT) ||
    trimmed.includes(`${OPENOBSERVE_API_SEGMENT}/`)
  ) {
    return trimmed;
  }

  if (
    trimmed.endsWith(OPENOBSERVE_UI_BASE_SEGMENT) ||
    trimmed.includes(`${OPENOBSERVE_UI_BASE_SEGMENT}/`)
  ) {
    return `${trimmed}${OPENOBSERVE_API_SEGMENT}`;
  }

  return `${trimmed}${OPENOBSERVE_API_SEGMENT}`;
};

export const buildOpenObserveIngestEndpoint = (
  baseUrl: string,
  org: string,
  stream: string,
): string => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return `${normalizedBaseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(stream)}/_json`;
};

export const buildOpenObserveApiPrefix = (baseUrl: string, org: string): string => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return `${normalizedBaseUrl}/${encodeURIComponent(org)}/`;
};

export const buildOpenObserveTraceEndpoint = (baseUrl: string, org: string): string => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return `${normalizedBaseUrl}/${encodeURIComponent(org)}/v1/traces`;
};
