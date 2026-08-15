CREATE TYPE "BeneficiaryType" AS ENUM ('BANK', 'CRYPTO');

ALTER TABLE "Beneficiary"
  ADD COLUMN "type" "BeneficiaryType" NOT NULL DEFAULT 'BANK',
  ADD COLUMN "walletAddress" TEXT,
  ADD COLUMN "network" "CryptoNetwork",
  ALTER COLUMN "bankName" DROP NOT NULL,
  ALTER COLUMN "accountNumber" DROP NOT NULL,
  ALTER COLUMN "countryCode" DROP NOT NULL;

ALTER TABLE "Beneficiary"
  ADD CONSTRAINT "Beneficiary_destination_shape" CHECK (
    (
      "type" = 'BANK'
      AND "bankName" IS NOT NULL
      AND length(trim("bankName")) > 0
      AND "accountNumber" IS NOT NULL
      AND length(trim("accountNumber")) > 0
      AND "countryCode" IS NOT NULL
      AND length(trim("countryCode")) = 2
      AND "walletAddress" IS NULL
      AND "network" IS NULL
    )
    OR
    (
      "type" = 'CRYPTO'
      AND "currency" = 'USDT'
      AND "network" = 'TRON'
      AND "walletAddress" IS NOT NULL
      AND length(trim("walletAddress")) > 0
      AND "bankName" IS NULL
      AND "accountNumber" IS NULL
      AND "swiftBic" IS NULL
      AND "iban" IS NULL
      AND "bankAddress" IS NULL
      AND "countryCode" IS NULL
    )
  );

CREATE UNIQUE INDEX "Beneficiary_customerId_network_walletAddress_key"
  ON "Beneficiary"("customerId", "network", "walletAddress");
