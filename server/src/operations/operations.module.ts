import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { WithdrawalFeesModule } from '../withdrawal-fees/withdrawal-fees.module';

@Module({
  imports: [WithdrawalFeesModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
