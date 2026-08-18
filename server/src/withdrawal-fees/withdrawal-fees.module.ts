import { Module } from '@nestjs/common';
import { WithdrawalFeesController } from './withdrawal-fees.controller';
import { WithdrawalFeesService } from './withdrawal-fees.service';

@Module({
  controllers: [WithdrawalFeesController],
  providers: [WithdrawalFeesService],
  exports: [WithdrawalFeesService],
})
export class WithdrawalFeesModule {}
