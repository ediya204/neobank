import { WithdrawalStatusFacts, withdrawalStatusPresentation } from './withdrawal-status';

function facts(overrides: Partial<WithdrawalStatusFacts>): WithdrawalStatusFacts {
  return {
    status: 'FAILED',
    rawStatus: 'failed',
    custodyStatus: 'failed',
    accountingStatus: 'not_accounted',
    fundsStatus: 'not_reserved',
    amount: '0.1',
    netAmount: '0.1',
    ...overrides,
  };
}

describe('withdrawal status presentation', () => {
  it('shows a failed instruction with no Core reservation as no funds impact', () => {
    const presentation = withdrawalStatusPresentation(facts({}));

    expect(presentation.statusLabel).toBe('执行失败 · 无资金影响');
    expect(presentation.fundsLabel).toBe('未冻结（无 Core 资金占用）');
    expect(presentation.chainAmountLabel).toBe('未发送');
    expect(presentation.expectedArrivalLabel).toBe('—');
    expect(presentation.transactionHashLabel).toBe('无');
    expect(presentation.canReconcileCregisCID).toBe(false);
    expect(presentation.alertText).toContain('无需退款、释放或关联 Cregis CID');
  });

  it('keeps a signed Cregis rejection auditable without claiming funds are frozen', () => {
    const presentation = withdrawalStatusPresentation(
      facts({ rawStatus: 'provider_rejected', custodyStatus: 'submitted_to_cregis' })
    );

    expect(presentation.statusLabel).toBe('Cregis 已驳回 · 无资金影响');
    expect(presentation.alertText).toContain('该指令未冻结客户余额');
    expect(presentation.alertText).toContain('历史状态仍需按审批流程关闭');
    expect(presentation.canReconcileCregisCID).toBe(false);
  });

  it('shows a pre-submission rejection as terminal with no refund action', () => {
    const presentation = withdrawalStatusPresentation(
      facts({ rawStatus: 'rejected', custodyStatus: 'rejected', amount: '0.000001' })
    );

    expect(presentation.statusLabel).toBe('已驳回 · 无资金影响');
    expect(presentation.alertText).toContain('提交 Cregis 前已驳回');
    expect(presentation.alertText).toContain('无需退款或释放');
  });

  it('allows CID reconciliation only when the API confirms a frozen exception', () => {
    const presentation = withdrawalStatusPresentation(
      facts({
        rawStatus: 'exception',
        custodyStatus: 'exception',
        accountingStatus: 'approved',
        fundsStatus: 'frozen',
        canReconcileCregisCID: true,
      })
    );

    expect(presentation.statusLabel).toBe('异常待核对');
    expect(presentation.fundsLabel).toBe('0.1 USDT 已冻结');
    expect(presentation.alertText).toContain('Core 已冻结 0.1 USDT');
    expect(presentation.canReconcileCregisCID).toBe(true);
  });

  it('fails closed when funds evidence is missing', () => {
    const presentation = withdrawalStatusPresentation(
      facts({
        rawStatus: 'exception',
        custodyStatus: 'exception',
        accountingStatus: 'not_accounted',
        fundsStatus: 'review_required',
        canReconcileCregisCID: true,
      })
    );

    expect(presentation.fundsLabel).toBe('待核实（不可推断已冻结）');
    expect(presentation.alertText).toContain('不能判定已冻结或已释放');
    expect(presentation.canReconcileCregisCID).toBe(false);
  });

  it('does not infer a frozen state from accounting status when the API field is absent', () => {
    const presentation = withdrawalStatusPresentation(
      facts({
        rawStatus: 'exception',
        custodyStatus: 'exception',
        accountingStatus: 'approved',
        fundsStatus: undefined,
        canReconcileCregisCID: true,
      })
    );

    expect(presentation.fundsLabel).toBe('待核实（不可推断已冻结）');
    expect(presentation.canReconcileCregisCID).toBe(false);
  });
});
