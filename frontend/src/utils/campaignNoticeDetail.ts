export const CAMPAIGN_NOTICE_DETAIL_EVENT = "tanva:campaign-notice:detail";

export const openCampaignNoticeDetail = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CAMPAIGN_NOTICE_DETAIL_EVENT));
};
