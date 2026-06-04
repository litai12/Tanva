export const OPEN_WECHAT_QR_PANEL_EVENT = "tanva:open-wechat-qrcodes";
export const WECHAT_QR_ACTION_URL = "/__action__/wechat";

const WECHAT_QR_ACTION_URLS = new Set([
  WECHAT_QR_ACTION_URL,
  "/__action__/wechat-qrcodes",
  "/__tanva_action__/wechat",
]);

export const isWechatQrActionUrl = (value?: string | null) =>
  WECHAT_QR_ACTION_URLS.has((value || "").trim());

export const shouldOpenWechatQrFromNoticeAction = (
  url?: string | null,
  label?: string | null
) => {
  const normalizedUrl = (url || "").trim();
  if (isWechatQrActionUrl(normalizedUrl)) return true;
  return !normalizedUrl && /(?:社群|微信群|微信|wechat)/i.test(label || "");
};

export const openWechatQrPanel = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_WECHAT_QR_PANEL_EVENT));
};
