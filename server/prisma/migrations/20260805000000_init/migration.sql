-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MAKER', 'CHECKER', 'OPERATOR', 'CUSTOMER_ADMIN', 'CUSTOMER_USER');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'SGD', 'HKD', 'EUR', 'GBP', 'USDT');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('SYSTEM_WALLET', 'VIRTUAL_ACCOUNT', 'CRYPTO_WALLET', 'PLATFORM_CLEARING', 'FEE_REVENUE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'FROZEN', 'CLOSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AccountRequestStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('DEPOSIT', 'PAYOUT', 'ADJUSTMENT', 'INTERNAL_TRANSFER', 'FX', 'OTC');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('VA', 'POBO', 'PLATFORM');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "JournalSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('FX', 'OTC');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('FIAT_INBOUND', 'VA_PAYOUT', 'POBO_PAYOUT', 'PLATFORM_PAYOUT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "supportedCurrencies" "Currency"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "settlementBankName" TEXT,
    "settlementAccount" TEXT,
    "swiftBic" TEXT,
    "instructions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT,
    "type" "CustomerType" NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'DRAFT',
    "displayName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "countryCode" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "registrationNo" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualAccountRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "AccountRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "preferredCountry" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "rejectionReason" TEXT,
    "assignedAccountId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualAccountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "kind" "AccountKind" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "currency" "Currency" NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "bankAddress" TEXT,
    "swiftBic" TEXT,
    "iban" TEXT,
    "walletAddress" TEXT,
    "network" TEXT,
    "availableBalance" DECIMAL(36,8) NOT NULL DEFAULT 0,
    "frozenBalance" DECIMAL(36,8) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "swiftBic" TEXT,
    "iban" TEXT,
    "bankAddress" TEXT,
    "countryCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "customerId" TEXT NOT NULL,
    "channelId" TEXT,
    "type" "OperationType" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(36,8) NOT NULL,
    "feeAmount" DECIMAL(36,8) NOT NULL DEFAULT 0,
    "sourceAccountId" TEXT,
    "targetAccountId" TEXT,
    "beneficiaryId" TEXT,
    "payoutMethod" "PayoutMethod",
    "adjustmentDirection" "AdjustmentDirection",
    "quoteCurrency" "Currency",
    "quoteAmount" DECIMAL(36,8),
    "rate" DECIMAL(24,12),
    "rateVersionId" TEXT,
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "operatorId" TEXT,
    "rejectionReason" TEXT,
    "externalReference" TEXT,
    "remitterName" TEXT,
    "remitterBank" TEXT,
    "remittanceReference" TEXT,
    "receivedAt" TIMESTAMP(3),
    "proofUrl" TEXT,
    "narrative" TEXT,
    "metadata" JSONB,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "JournalSide" NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(36,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateVersion" (
    "id" TEXT NOT NULL,
    "type" "RateType" NOT NULL,
    "baseCurrency" "Currency" NOT NULL,
    "quoteCurrency" "Currency" NOT NULL,
    "buyRate" DECIMAL(24,12) NOT NULL,
    "sellRate" DECIMAL(24,12) NOT NULL,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "FundingChannel_organizationId_type_active_idx" ON "FundingChannel"("organizationId", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "FundingChannel_organizationId_code_key" ON "FundingChannel"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Customer_organizationId_status_idx" ON "Customer"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_externalId_key" ON "Customer"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualAccountRequest_assignedAccountId_key" ON "VirtualAccountRequest"("assignedAccountId");

-- CreateIndex
CREATE INDEX "VirtualAccountRequest_customerId_status_idx" ON "VirtualAccountRequest"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Account_accountNumber_key" ON "Account"("accountNumber");

-- CreateIndex
CREATE INDEX "Account_customerId_kind_currency_idx" ON "Account"("customerId", "kind", "currency");

-- CreateIndex
CREATE INDEX "Beneficiary_customerId_active_idx" ON "Beneficiary"("customerId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_reference_key" ON "Operation"("reference");

-- CreateIndex
CREATE INDEX "Operation_customerId_status_createdAt_idx" ON "Operation"("customerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Operation_status_type_createdAt_idx" ON "Operation"("status", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_customerId_idempotencyKey_key" ON "Operation"("customerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reference_key" ON "JournalEntry"("reference");

-- CreateIndex
CREATE INDEX "JournalEntry_operationId_idx" ON "JournalEntry"("operationId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_createdAt_idx" ON "JournalLine"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "RateVersion_type_baseCurrency_quoteCurrency_active_effectiv_idx" ON "RateVersion"("type", "baseCurrency", "quoteCurrency", "active", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "FundingChannel" ADD CONSTRAINT "FundingChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccountRequest" ADD CONSTRAINT "VirtualAccountRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccountRequest" ADD CONSTRAINT "VirtualAccountRequest_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccountRequest" ADD CONSTRAINT "VirtualAccountRequest_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccountRequest" ADD CONSTRAINT "VirtualAccountRequest_assignedAccountId_fkey" FOREIGN KEY ("assignedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "FundingChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_rateVersionId_fkey" FOREIGN KEY ("rateVersionId") REFERENCES "RateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
