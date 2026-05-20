-- Prevent multiple active subscriptions per team at DB level
CREATE UNIQUE INDEX "TeamSubscription_one_active_per_team"
  ON "TeamSubscription"("teamId")
  WHERE status = 'active';
