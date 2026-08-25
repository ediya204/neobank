import { BadRequestException, Controller, Param, Post } from '@nestjs/common';
import { CregisAccountingService } from './cregis-accounting.service';

const SAFE_RECORD_ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

@Controller('internal/cregis')
export class CregisAccountingController {
  constructor(private readonly accounting: CregisAccountingService) {}

  @Post('deposits/:id/post')
  postDeposit(@Param('id') id: string) {
    return this.accounting.postDeposit(this.recordId(id));
  }

  @Post('withdrawals/:id/reserve')
  reserveWithdrawal(@Param('id') id: string) {
    return this.accounting.advanceWithdrawal(this.recordId(id), 'reserve');
  }

  @Post('withdrawals/:id/approve')
  approveWithdrawal(@Param('id') id: string) {
    return this.accounting.advanceWithdrawal(this.recordId(id), 'approve');
  }

  @Post('withdrawals/:id/release')
  releaseWithdrawal(@Param('id') id: string) {
    return this.accounting.advanceWithdrawal(this.recordId(id), 'release');
  }

  @Post('withdrawals/:id/settle')
  settleWithdrawal(@Param('id') id: string) {
    return this.accounting.advanceWithdrawal(this.recordId(id), 'settle');
  }

  private recordId(value: string) {
    if (!SAFE_RECORD_ID.test(value)) {
      throw new BadRequestException({ error: { code: 'invalid_cregis_record_id' } });
    }
    return value;
  }
}
