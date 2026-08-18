CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DEAD');

CREATE TYPE "EmailTemplateKey" AS ENUM (
  'CUSTOMER_KYC_APPROVED',
  'CUSTOMER_KYC_REJECTED',
  'CUSTOMER_ACTIVATED',
  'VIRTUAL_ACCOUNT_APPROVED',
  'VIRTUAL_ACCOUNT_REJECTED'
);

CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "templateKey" "EmailTemplateKey" NOT NULL,
  "recipient" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastErrorCode" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_dedupeKey_key" ON "EmailOutbox"("dedupeKey");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_createdAt_idx"
  ON "EmailOutbox"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "EmailOutbox_organizationId_createdAt_idx"
  ON "EmailOutbox"("organizationId", "createdAt");
CREATE INDEX "EmailOutbox_customerId_createdAt_idx"
  ON "EmailOutbox"("customerId", "createdAt");

ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT "EmailOutbox_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
