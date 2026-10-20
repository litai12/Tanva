import { ServiceUnavailableException } from '@nestjs/common';

/** Only these fixed diagnostics cross the desktop boundary. Never include an
 * upstream body, network exception, URL or credential in the response. */
export const DESKTOP_CATALOG_MESSAGES = {
  TANVA_MODEL_GATEWAY_UNCONFIGURED: '模型网关凭据未配置，请联系管理员检查服务配置。',
  TANVA_MODEL_GATEWAY_AUTH_FAILED: '模型网关鉴权失败，请联系管理员检查网关凭据与权限。',
  TANVA_MODEL_GATEWAY_ENDPOINT_MISSING: '模型网关未提供模型或报价接口，请联系管理员检查网关版本与地址。',
  TANVA_MODEL_GATEWAY_RATE_LIMITED: '模型目录请求频率受限，请稍后重试。',
  TANVA_MODEL_GATEWAY_UNAVAILABLE: '模型网关暂不可用，请稍后重试。',
  TANVA_MODEL_CATALOG_INVALID: '模型网关目录或报价格式无效，请联系管理员检查网关版本与计价配置。',
  TANVA_MODEL_CATALOG_TIMEOUT: '读取模型目录超时，请稍后重试。',
  TANVA_MODEL_CATALOG_NETWORK_FAILED: '无法连接模型网关，请稍后重试或联系管理员检查网络。',
} as const;

export type DesktopCatalogCode = keyof typeof DESKTOP_CATALOG_MESSAGES;

export function catalogUnavailable(code: DesktopCatalogCode, upstreamStatus?: number): ServiceUnavailableException {
  // An upstream 401 is a gateway configuration error, not a Tanva login expiry.
  return new ServiceUnavailableException({ code, message: DESKTOP_CATALOG_MESSAGES[code],
    ...(Number.isInteger(upstreamStatus) && upstreamStatus! >= 100 && upstreamStatus! <= 599 ? { upstreamStatus } : {}) });
}

export function catalogHttpFailure(status: number): ServiceUnavailableException {
  return catalogUnavailable(status === 401 || status === 403 ? 'TANVA_MODEL_GATEWAY_AUTH_FAILED'
    : status === 404 || status === 405 ? 'TANVA_MODEL_GATEWAY_ENDPOINT_MISSING'
    : status === 429 ? 'TANVA_MODEL_GATEWAY_RATE_LIMITED' : 'TANVA_MODEL_GATEWAY_UNAVAILABLE', status);
}
