-- Event reminders are sent at most once
ALTER TABLE "Event" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- Persistent failed-login ledger (replaces the in-memory lockout map)
CREATE TABLE "LoginAttempt" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");
