import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DepositAccountingWorker } from './deposit-accounting.worker';
import {
  DirectWithdrawalAccountingAction,
  WithdrawalAccountingWorker,
} from './withdrawal-accounting.worker';

@Injectable()
export class CregisAccountingService {
  constructor(
    private readonly deposits: DepositAccountingWorker,
    private readonly withdrawals: WithdrawalAccountingWorker
  ) {}

  async postDeposit(depositId: string) {
    this.requireEnabled();
    try {
      const result = await this.deposits.processDirect(depositId);
      if (result.retryable) {
        throw new ServiceUnavailableException({
          error: { code: 'cregis_accounting_retryable' },
          status: result.status,
        });
      }
      return { id: depositId, status: result.status, idempotent: result.idempotent };
    } catch (caught) {
      if (caught instanceof ServiceUnavailableException) throw caught;
      if (this.errorCode(caught) === 'deposit_direct_state_conflict') {
        return { id: depositId, status: 'exception', idempotent: false };
      }
      throw new ServiceUnavailableException({ error: { code: 'cregis_accounting_unavailable' } });
    }
  }

  async advanceWithdrawal(withdrawalId: string, action: DirectWithdrawalAccountingAction) {
    this.requireEnabled();
    try {
      const result = await this.withdrawals.processDirect(withdrawalId, action);
      if (result.retryable) {
        throw new ServiceUnavailableException({
          error: { code: 'cregis_accounting_retryable' },
          status: result.status,
        });
      }
      return { id: withdrawalId, action, status: result.status, idempotent: result.idempotent };
    } catch (caught) {
      if (caught instanceof ServiceUnavailableException) throw caught;
      if (this.errorCode(caught) === 'withdrawal_direct_state_conflict') {
        return { id: withdrawalId, action, status: 'exception', idempotent: false };
      }
      throw new ServiceUnavailableException({ error: { code: 'cregis_accounting_unavailable' } });
    }
  }

  private requireEnabled() {
    if (process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED?.trim().toLowerCase() !== 'true') {
      throw new ServiceUnavailableException({
        error: { code: 'cregis_direct_accounting_disabled' },
      });
    }
  }

  private errorCode(caught: unknown) {
    if (caught && typeof caught === 'object' && 'code' in caught) {
      return String(caught.code);
    }
    return '';
  }
}
