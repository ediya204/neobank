import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { CustomerPayoutsController } from './customer-payouts.controller';
import { OperationsService } from './operations.service';
import { WithdrawalFeesModule } from '../withdrawal-fees/withdrawal-fees.module';

@Module({
  imports: [WithdrawalFeesModule],
  controllers: [OperationsController, CustomerPayoutsController],
  providers: [OperationsService],
})
export class OperationsModule {}
