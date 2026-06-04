export const CAMPAIGN_NOTICE_DEADLINE_MS = Date.parse(
  "2026-06-05T00:00:00+08:00"
);

export const isCampaignNoticeAvailable = (nowMs = Date.now()) =>
  nowMs < CAMPAIGN_NOTICE_DEADLINE_MS;
