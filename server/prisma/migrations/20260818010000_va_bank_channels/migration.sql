ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'VIRTUAL_ACCOUNT';

DO $$
BEGIN
  CREATE TYPE "VaRequestSource" AS ENUM ('ADMIN', 'CUSTOMER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "FundingChannel"
  ADD COLUMN IF NOT EXISTS "bankCountry" TEXT,
  ADD COLUMN IF NOT EXISTS "bankAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "branchName" TEXT;

ALTER TABLE "VirtualAccountRequest"
  ADD COLUMN IF NOT EXISTS "channelId" TEXT,
  ADD COLUMN IF NOT EXISTS "requestSource" "VaRequestSource" NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN IF NOT EXISTS "requesterEmail" TEXT;

ALTER TABLE "Account"
  ADD COLUMN IF NOT EXISTS "bankCountry" TEXT,
  ADD COLUMN IF NOT EXISTS "branchName" TEXT,
  ADD COLUMN IF NOT EXISTS "fundingChannelId" TEXT;

CREATE INDEX IF NOT EXISTS "VirtualAccountRequest_channelId_status_idx"
  ON "VirtualAccountRequest"("channelId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "VirtualAccountRequest_pending_channel_currency_key"
  ON "VirtualAccountRequest"("customerId", "channelId", "currency")
  WHERE "status" = 'SUBMITTED' AND "channelId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Account_fundingChannelId_kind_idx"
  ON "Account"("fundingChannelId", "kind");

DO $$
BEGIN
  ALTER TABLE "VirtualAccountRequest"
    ADD CONSTRAINT "VirtualAccountRequest_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "FundingChannel"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Account"
    ADD CONSTRAINT "Account_fundingChannelId_fkey"
    FOREIGN KEY ("fundingChannelId") REFERENCES "FundingChannel"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
