/**
 * 将 Generate Refer（参考图生成）节点常见的原始错误转为可读说明（中英）。
 * 仅对已知模式做映射，其余返回 null 由调用方回退显示原文。
 */
export type GenerateRefErrorHint = { zh: string; en: string };

const COMPRESS_NODE_ZH = '可使用画板中的「图片压缩」节点缩小参考图后再试。';
const COMPRESS_NODE_EN =
  'Use the "Image Compress" node on the canvas to reduce reference images, then retry.';

export function explainGenerateReferenceImageError(
  raw: string | undefined | null
): GenerateRefErrorHint | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const lower = s.toLowerCase();

  // 413 / 网关或 body 过大（常见于多图 base64 或超高分辨率）
  if (
    /\b413\b/.test(s) ||
    /\bhttp_413\b/i.test(s) ||
    /payload too large|request entity too large|entity too large/i.test(s) ||
    /请求数据过大|体积过大|文件过大|内容过大/i.test(s)
  ) {
    return {
      zh: `请求体过大（多为参考图分辨率、体积过大，或网关/服务对单次请求大小有限制）。${COMPRESS_NODE_ZH}`,
      en: `Payload too large (often due to image resolution/size or gateway limits on request size). ${COMPRESS_NODE_EN}`,
    };
  }

  // 415 / 不支持的媒体类型
  if (
    /\b415\b/.test(s) ||
    /\bhttp_415\b/i.test(s) ||
    /unsupported media|invalid mime|mime type not supported/i.test(lower)
  ) {
    return {
      zh: '参考图格式或媒体类型不被当前接口支持。请使用 PNG、JPEG、WebP 等常见格式，或经「图片压缩」节点导出后再连接本节点。',
      en: 'Reference image format or media type is not supported. Use PNG, JPEG, or WebP, or pass the image through the Image Compress node first.',
    };
  }

  // 超时（含网关 408/504/524）
  if (
    /\b408\b|\b504\b|\b524\b/.test(s) ||
    /timeout|timed out|超时|aborted|aborterror/i.test(lower)
  ) {
    return {
      zh: '请求或参考图加载超时。请检查网络、换用体积更小的图片，或稍后重试。',
      en: 'The request or reference image load timed out. Check your network, try smaller images, or retry later.',
    };
  }

  // 显式文件/像素过大（上游或本服务校验）
  if (
    /file is too large|15mb|20mb|base64 length/i.test(lower) ||
    /像素|分辨率|尺寸|宽高|dimension|resolution|too many pixels|image too large/i.test(
      s
    )
  ) {
    return {
      zh: `参考图像素或文件体积超过限制。${COMPRESS_NODE_ZH}`,
      en: `Reference image exceeds pixel or file size limits. ${COMPRESS_NODE_EN}`,
    };
  }

  // 网络层
  if (
    /网络异常|failed to fetch|network error|econnreset|load failed|err_network/i.test(
      lower
    )
  ) {
    return {
      zh: '网络异常：加载或上传参考图失败。请检查网络与图片地址是否可访问。',
      en: 'Network error while loading or uploading the reference image. Check connectivity and whether the image URL is reachable.',
    };
  }

  // 上传类超时文案（与其它模块一致）
  if (/图片上传超时|上传超时/.test(s)) {
    return {
      zh: '图片上传超时。请换用较小的参考图或检查网络后重试；也可先用「图片压缩」节点减小体积。',
      en: 'Image upload timed out. Try smaller images or check your network; the Image Compress node can help reduce file size.',
    };
  }

  return null;
}
