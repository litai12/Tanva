-- Prevent multiple personal teams per user
CREATE UNIQUE INDEX "Team_one_personal_per_owner"
  ON "Team"("ownerId")
  WHERE "isPersonal" = true;
