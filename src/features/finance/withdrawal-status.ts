export type WithdrawalFundsStatus =
  | 'not_reserved'
  | 'reservation_pending'
  | 'frozen'
  | 'release_pending'
  | 'released'
  | 'settlement_pending'
  | 'settled'
  | 'review_required';

export type WithdrawalStatusFacts = {
  status: 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  rawStatus?: string;
  custodyStatus?: string;
  accountingStatus?: string;
  fundsStatus?: string;
  amount: string;
  netAmount: string;
  txHash?: string;
  cregisCID?: string;
  canReconcileCregisCID?: boolean;
};

export type WithdrawalStatusPresentation = {
  statusLabel: string;
  statusColor: 'default' | 'warning' | 'info' | 'success' | 'error';
  fundsLabel: string;
  chainAmountLabel: string;
  expectedArrivalLabel: string;
  transactionHashLabel: string;
  alertSeverity?: 'warning' | 'info' | 'success' | 'error';
  alertText?: string;
  canReconcileCregisCID: boolean;
  needsAttention: boolean;
};

const knownFundsStatuses = new Set<WithdrawalFundsStatus>([
  'not_reserved',
  'reservation_pending',
  'frozen',
  'release_pending',
  'released',
  'settlement_pending',
  'settled',
  'review_required',
]);

function normalizeFundsStatus(facts: WithdrawalStatusFacts): WithdrawalFundsStatus {
  if (knownFundsStatuses.has(facts.fundsStatus as WithdrawalFundsStatus)) {
    return facts.fundsStatus as WithdrawalFundsStatus;
  }
  return 'review_required';
}

type ChainStatus = 'not_submitted' | 'waiting' | 'completed' | 'not_sent' | 'review_required';

function normalizeChainStatus(facts: WithdrawalStatusFacts): ChainStatus {
  const custodyStatus = facts.custodyStatus || facts.rawStatus || '';
  if (facts.txHash || facts.rawStatus === 'completed' || custodyStatus === 'completed') {
    return 'completed';
  }
  if (['provider_rejected', 'rejected', 'failed', 'cancelled'].includes(facts.rawStatus || '')) {
    return 'not_sent';
  }
  if (['rejected', 'failed', 'cancelled'].includes(custodyStatus)) return 'not_sent';
  if (facts.rawStatus === 'exception' || custodyStatus === 'exception') return 'review_required';
  if (
    facts.cregisCID ||
    ['submitted_to_cregis', 'executing'].includes(custodyStatus) ||
    facts.status === 'PROCESSING'
  ) {
    return 'waiting';
  }
  return 'not_submitted';
}

function fundsLabel(status: WithdrawalFundsStatus, amount: string) {
  const amountLabel = `${amount} USDT`;
  const labels: Record<WithdrawalFundsStatus, string> = {
    not_reserved: '未冻结（无 Core 资金占用）',
    reservation_pending: '等待 Core 冻结',
    frozen: `${amountLabel} 已冻结`,
    release_pending: `${amountLabel} 待释放`,
    released: `${amountLabel} 已释放`,
    settlement_pending: `${amountLabel} 待结算`,
    settled: `${amountLabel} 已扣账`,
    review_required: '待核实（不可推断已冻结）',
  };
  return labels[status];
}

function statusPresentation(
  facts: WithdrawalStatusFacts,
  fundsStatus: WithdrawalFundsStatus
): Pick<WithdrawalStatusPresentation, 'statusLabel' | 'statusColor'> {
  if (facts.rawStatus === 'provider_rejected') {
    return {
      statusLabel:
        fundsStatus === 'not_reserved' ? 'Cregis 已驳回 · 无资金影响' : 'Cregis 已驳回 · 待对账',
      statusColor: 'error',
    };
  }
  if (facts.rawStatus === 'reconciliation_held') {
    return { statusLabel: '历史对账待放行', statusColor: 'warning' };
  }
  if (facts.rawStatus === 'pending_release') {
    return { statusLabel: '等待资金释放', statusColor: 'warning' };
  }
  if (facts.rawStatus === 'releasing') {
    return { statusLabel: '资金释放中', statusColor: 'info' };
  }
  if (facts.rawStatus === 'exception') {
    return {
      statusLabel: fundsStatus === 'not_reserved' ? '处理失败 · 无资金影响' : '异常待核对',
      statusColor: 'warning',
    };
  }
  if (facts.rawStatus === 'cancelled') {
    return {
      statusLabel: fundsStatus === 'not_reserved' ? '已取消 · 无资金影响' : '已取消',
      statusColor: 'default',
    };
  }
  if (facts.rawStatus === 'rejected' && fundsStatus === 'not_reserved') {
    return { statusLabel: '已驳回 · 无资金影响', statusColor: 'error' };
  }
  if (facts.rawStatus === 'failed' && fundsStatus === 'not_reserved') {
    return { statusLabel: '执行失败 · 无资金影响', statusColor: 'error' };
  }

  const labels = {
    SUBMITTED: '待审批',
    PROCESSING: '处理中',
    COMPLETED: '已完成',
    REJECTED: '已驳回',
    FAILED: '失败',
  } as const;
  const colors = {
    SUBMITTED: 'warning',
    PROCESSING: 'info',
    COMPLETED: 'success',
    REJECTED: 'error',
    FAILED: 'error',
  } as const;
  return { statusLabel: labels[facts.status], statusColor: colors[facts.status] };
}

function alertPresentation(
  facts: WithdrawalStatusFacts,
  fundsStatus: WithdrawalFundsStatus
): Pick<WithdrawalStatusPresentation, 'alertSeverity' | 'alertText' | 'needsAttention'> {
  if (facts.rawStatus === 'provider_rejected' && fundsStatus === 'not_reserved') {
    return {
      alertSeverity: 'error',
      alertText:
        'Cregis 已签名驳回，未生成 TXID，未发生链上转出。系统未建立 Core 资金占用，该指令未冻结客户余额，无需退款或释放；该历史状态仍需按审批流程关闭。',
      needsAttention: true,
    };
  }
  if (facts.rawStatus === 'failed' && fundsStatus === 'not_reserved') {
    return {
      alertSeverity: 'warning',
      alertText:
        '指令执行失败，未发生链上转出，且未建立 Core 资金占用。该指令未冻结客户余额，无需退款、释放或关联 Cregis CID。',
      needsAttention: false,
    };
  }
  if (facts.rawStatus === 'rejected' && fundsStatus === 'not_reserved') {
    return {
      alertSeverity: 'info',
      alertText:
        '指令在提交 Cregis 前已驳回，未发生链上转出，也未建立 Core 资金占用。该指令未冻结客户余额，无需退款或释放。',
      needsAttention: false,
    };
  }
  if (facts.rawStatus === 'exception') {
    if (fundsStatus === 'frozen') {
      return {
        alertSeverity: 'warning',
        alertText: `该指令处于异常待核对状态，Core 已冻结 ${facts.amount} USDT。仅在 Cregis 后台确认对应 CID 后关联，并继续等待签名终态回调；切勿重复提交或人工修改余额。`,
        needsAttention: true,
      };
    }
    if (fundsStatus === 'not_reserved') {
      return {
        alertSeverity: 'warning',
        alertText:
          '该异常指令未建立 Core 资金占用，也未冻结客户余额。无需退款、释放或关联 Cregis CID；请按历史状态关闭流程处理。',
        needsAttention: true,
      };
    }
    return {
      alertSeverity: 'warning',
      alertText:
        '该指令的 Core 资金占用证据不完整，不能判定已冻结或已释放。请先完成只读核对；切勿重复提交、关联 CID 或人工修改余额。',
      needsAttention: true,
    };
  }
  if (facts.rawStatus === 'provider_rejected') {
    return {
      alertSeverity: 'error',
      alertText:
        'Cregis 已签名驳回且未发生链上转出。Core 资金尚未完成关闭，请通过受审批的历史出款对账流程释放或核实，切勿重复提交或直接修改余额。',
      needsAttention: true,
    };
  }
  if (facts.rawStatus === 'reconciliation_held') {
    return {
      alertSeverity: 'warning',
      alertText:
        '历史出款证据已固化，当前未移动资金。完成独立复核后，使用受审批的释放步骤送入自动释放队列。',
      needsAttention: true,
    };
  }
  if (facts.rawStatus === 'pending_release') {
    return {
      alertSeverity: 'warning',
      alertText:
        '出款已进入终止流程，Core 资金正在等待会计 Worker 自动释放；当前尚未完成，请勿人工修改余额。',
      needsAttention: true,
    };
  }
  if (facts.rawStatus === 'releasing') {
    return {
      alertSeverity: 'info',
      alertText:
        '会计 Worker 正在原子释放 Account 与 CryptoWallet 的冻结余额，请等待资金状态变为“已释放”。',
      needsAttention: true,
    };
  }
  if (fundsStatus === 'review_required') {
    return {
      alertSeverity: 'warning',
      alertText:
        '该指令的 Core 资金占用证据不完整，不能判定已冻结、已释放或已扣账。请先完成只读核对，勿执行资金操作。',
      needsAttention: true,
    };
  }
  return { needsAttention: false };
}

export function withdrawalStatusPresentation(
  facts: WithdrawalStatusFacts
): WithdrawalStatusPresentation {
  const fundsStatus = normalizeFundsStatus(facts);
  const chainStatus = normalizeChainStatus(facts);
  const status = statusPresentation(facts, fundsStatus);
  const alert = alertPresentation(facts, fundsStatus);

  const chainAmountLabels: Record<ChainStatus, string> = {
    not_submitted: '尚未发送',
    waiting: '等待 Cregis 终态确认',
    completed: `${facts.netAmount} USDT`,
    not_sent: '未发送',
    review_required: '待 Cregis 核实',
  };
  const expectedArrivalLabels: Record<ChainStatus, string> = {
    not_submitted: `${facts.netAmount} USDT`,
    waiting: `${facts.netAmount} USDT`,
    completed: `${facts.netAmount} USDT`,
    not_sent: '—',
    review_required: '待确认',
  };
  const transactionHashLabels: Record<ChainStatus, string> = {
    not_submitted: '尚未生成',
    waiting: '等待 Cregis 回调',
    completed: facts.txHash || '异常：缺少 TXID',
    not_sent: '无',
    review_required: '待核实',
  };

  return {
    ...status,
    ...alert,
    fundsLabel: fundsLabel(fundsStatus, facts.amount),
    chainAmountLabel: chainAmountLabels[chainStatus],
    expectedArrivalLabel: expectedArrivalLabels[chainStatus],
    transactionHashLabel: transactionHashLabels[chainStatus],
    canReconcileCregisCID:
      facts.canReconcileCregisCID === true &&
      facts.rawStatus === 'exception' &&
      fundsStatus === 'frozen',
  };
}
