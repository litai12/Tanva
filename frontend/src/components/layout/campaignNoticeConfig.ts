export const CAMPAIGN_NOTICE_DEADLINE_MS = Date.parse(
  "2026-06-06T00:00:00+08:00"
);

// The notice bar is only available while the campaign is running. Once the deadline
// passes (activity ended) it disappears automatically — no frozen 00:00:00 countdown.
// To run a new campaign, bump CAMPAIGN_NOTICE_DEADLINE_MS to a future date.
export const isCampaignNoticeAvailable = () =>
  Number.isFinite(CAMPAIGN_NOTICE_DEADLINE_MS) &&
  Date.now() < CAMPAIGN_NOTICE_DEADLINE_MS;
