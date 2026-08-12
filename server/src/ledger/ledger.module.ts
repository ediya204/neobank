import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';

@Module({ controllers: [LedgerController] })
export class LedgerModule {}
