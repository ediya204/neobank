CREATE TYPE "CryptoNetwork" AS ENUM ('TRON', 'BSC', 'ETHEREUM');
CREATE TYPE "CryptoTransferDirection" AS ENUM ('DEPOSIT', 'WITHDRAWAL');
CREATE TYPE "CryptoTransferStatus" AS ENUM ('SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED');

CREATE TABLE "CryptoWallet" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "asset" "Currency" NOT NULL DEFAULT 'USDT',
    "network" "CryptoNetwork" NOT NULL,
    "networkLabel" TEXT NOT NULL,
    "tokenStandard" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "availableBalance" DECIMAL(36,8) NOT NULL DEFAULT 0,
    "frozenBalance" DECIMAL(36,8) NOT NULL DEFAULT 0,
    "minimumDeposit" DECIMAL(36,8) NOT NULL DEFAULT 1,
    "withdrawalFee" DECIMAL(36,8) NOT NULL DEFAULT 0,
    "confirmationsRequired" INTEGER NOT NULL DEFAULT 12,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CryptoWallet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CryptoWallet_nonnegative_balances" CHECK ("availableBalance" >= 0 AND "frozenBalance" >= 0)
);

CREATE TABLE "CryptoTransfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "customerId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "asset" "Currency" NOT NULL DEFAULT 'USDT',
    "network" "CryptoNetwork" NOT NULL,
    "direction" "CryptoTransferDirection" NOT NULL,
    "status" "CryptoTransferStatus" NOT NULL DEFAULT 'SUBMITTED',
    "amount" DECIMAL(36,8) NOT NULL,
    "feeAmount" DECIMAL(36,8) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(36,8) NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "operatorId" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CryptoTransfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CryptoTransfer_positive_amount" CHECK ("amount" > 0 AND "feeAmount" >= 0 AND "netAmount" > 0),
    CONSTRAINT "CryptoTransfer_maker_checker" CHECK ("checkerId" IS NULL OR "makerId" <> "checkerId")
);

CREATE UNIQUE INDEX "CryptoWallet_customerId_asset_network_key" ON "CryptoWallet"("customerId", "asset", "network");
CREATE UNIQUE INDEX "CryptoWallet_network_walletAddress_key" ON "CryptoWallet"("network", "walletAddress");
CREATE INDEX "CryptoWallet_customerId_status_idx" ON "CryptoWallet"("customerId", "status");
CREATE UNIQUE INDEX "CryptoTransfer_reference_key" ON "CryptoTransfer"("reference");
CREATE UNIQUE INDEX "CryptoTransfer_customerId_idempotencyKey_key" ON "CryptoTransfer"("customerId", "idempotencyKey");
CREATE INDEX "CryptoTransfer_customerId_direction_status_createdAt_idx" ON "CryptoTransfer"("customerId", "direction", "status", "createdAt");
CREATE INDEX "CryptoTransfer_status_createdAt_idx" ON "CryptoTransfer"("status", "createdAt");

ALTER TABLE "CryptoWallet" ADD CONSTRAINT "CryptoWallet_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryptoTransfer" ADD CONSTRAINT "CryptoTransfer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryptoTransfer" ADD CONSTRAINT "CryptoTransfer_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CryptoWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryptoTransfer" ADD CONSTRAINT "CryptoTransfer_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CryptoTransfer" ADD CONSTRAINT "CryptoTransfer_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CryptoTransfer" ADD CONSTRAINT "CryptoTransfer_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
