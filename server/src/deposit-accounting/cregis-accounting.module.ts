import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CregisAccountingController } from './cregis-accounting.controller';
import { CregisAccountingService } from './cregis-accounting.service';
import { DepositAccountingWorker } from './deposit-accounting.worker';
import { WithdrawalAccountingWorker } from './withdrawal-accounting.worker';

@Module({
  imports: [PrismaModule],
  controllers: [CregisAccountingController],
  providers: [CregisAccountingService, DepositAccountingWorker, WithdrawalAccountingWorker],
  exports: [CregisAccountingService, DepositAccountingWorker, WithdrawalAccountingWorker],
})
export class CregisAccountingModule {}
