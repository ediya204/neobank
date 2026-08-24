import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CregisAccountingModule } from './cregis-accounting.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CregisAccountingModule],
})
export class DepositAccountingWorkerModule {}
