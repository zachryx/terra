ALTER TABLE "Order" ADD COLUMN "confirmationSentAt" TIMESTAMP(3);

CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutboxEvent_processedAt_createdAt_idx" ON "OutboxEvent"("processedAt", "createdAt");

CREATE TABLE "DeadLetter" (
  "id" TEXT NOT NULL,
  "queue" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "jobId" TEXT,
  "payload" JSONB NOT NULL,
  "error" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeadLetter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeadLetter_createdAt_idx" ON "DeadLetter"("createdAt");
