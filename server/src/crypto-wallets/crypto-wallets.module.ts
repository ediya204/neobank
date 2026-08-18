import { Module } from '@nestjs/common';
import { CryptoWalletsController } from './crypto-wallets.controller';
import { CryptoWalletsService } from './crypto-wallets.service';
import { WithdrawalFeesModule } from '../withdrawal-fees/withdrawal-fees.module';

@Module({
  imports: [WithdrawalFeesModule],
  controllers: [CryptoWalletsController],
  providers: [CryptoWalletsService],
})
export class CryptoWalletsModule {}
