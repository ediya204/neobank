import { Module } from '@nestjs/common';
import { CryptoWalletsController } from './crypto-wallets.controller';
import { CryptoWalletsService } from './crypto-wallets.service';

@Module({
  controllers: [CryptoWalletsController],
  providers: [CryptoWalletsService],
})
export class CryptoWalletsModule {}
