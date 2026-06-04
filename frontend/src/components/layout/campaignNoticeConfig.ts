export const CAMPAIGN_NOTICE_START_MS = Date.parse(
  "2026-06-04T00:00:00+08:00"
);

export const CAMPAIGN_NOTICE_DEADLINE_MS = Date.parse(
  "2026-06-05T23:59:59+08:00"
);

export const isCampaignNoticeAvailable = (nowMs = Date.now()) =>
  nowMs >= CAMPAIGN_NOTICE_START_MS && nowMs < CAMPAIGN_NOTICE_DEADLINE_MS;
