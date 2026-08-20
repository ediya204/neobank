import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { DepositAccountingWorker } from './deposit-accounting.worker';
import { WithdrawalAccountingWorker } from './withdrawal-accounting.worker';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [DepositAccountingWorker, WithdrawalAccountingWorker],
})
export class DepositAccountingWorkerModule {}
