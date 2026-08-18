import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { OperationsModule } from './operations/operations.module';
import { AccountsModule } from './accounts/accounts.module';
import { CustomersModule } from './customers/customers.module';
import { ChannelsModule } from './channels/channels.module';
import { BeneficiariesModule } from './beneficiaries/beneficiaries.module';
import { RatesModule } from './rates/rates.module';
import { CryptoWalletsModule } from './crypto-wallets/crypto-wallets.module';
import { LedgerModule } from './ledger/ledger.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EmailModule,
    CustomersModule,
    ChannelsModule,
    BeneficiariesModule,
    RatesModule,
    CryptoWalletsModule,
    LedgerModule,
    AccountsModule,
    OperationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
