CREATE UNIQUE INDEX "Operation_channelId_remittanceReference_key"
  ON "Operation"("channelId", "remittanceReference");
