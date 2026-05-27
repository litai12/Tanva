-- Add foreign key from Team.ownerId to User.id with RESTRICT on delete
-- Prevents deleting a user who owns one or more teams
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
