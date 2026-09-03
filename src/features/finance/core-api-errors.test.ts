import { apiErrorMessage, vaOpeningFeeQuote } from './core-api';

it('translates customer Core authorization details into a recoverable customer message', () => {
  expect(apiErrorMessage(undefined, 'customer_core_route_forbidden', 403)).toBe(
    '账户资料暂时无法读取，请刷新账户或重新登录后重试。'
  );
});

it('preserves business errors that callers use for specific recovery flows', () => {
  expect(apiErrorMessage(undefined, 'quote_expired', 409)).toBe('quote_expired');
  expect(apiErrorMessage('报价已失效', 'quote_expired', 409)).toBe('报价已失效');
});

it('translates VA opening fee failures into actionable customer messages', () => {
  expect(apiErrorMessage(undefined, 'virtual_account_opening_fee_changed', 409)).toBe(
    '开户手续费已更新，请确认最新金额后重新提交。'
  );
  expect(apiErrorMessage(undefined, 'virtual_account_opening_fee_not_configured', 409)).toBe(
    '所选银行暂未配置开户手续费，请选择其他银行或稍后重试。'
  );
  expect(apiErrorMessage(undefined, 'usd_wallet_not_found', 409)).toBe(
    '未找到可用的 USD 钱包，暂时无法支付开户手续费。'
  );
  expect(apiErrorMessage(undefined, 'insufficient_available_balance', 409)).toBe(
    'USD 钱包可用余额不足，请充值后重试。'
  );
  expect(apiErrorMessage('insufficient_available_balance', undefined, 409)).toBe(
    'USD 钱包可用余额不足，请充值后重试。'
  );
});

it('builds one VA opening fee confirmation from the active USD wallet', () => {
  const channel = {
    id: 'channel_001',
    code: 'VA-HK-01',
    name: 'Example Bank',
    type: 'VIRTUAL_ACCOUNT' as const,
    supportedCurrencies: ['USD' as const],
    active: true,
    openingFeeUsd: '25.00',
    openingFeeVersion: '2',
  };
  const wallet = {
    id: 'wallet_usd',
    customerId: 'customer_001',
    kind: 'SYSTEM_WALLET' as const,
    status: 'ACTIVE' as const,
    currency: 'USD' as const,
    name: 'SSC钱包',
    availableBalance: '100.00',
    frozenBalance: '5.00',
  };

  expect(vaOpeningFeeQuote(channel, [wallet])).toEqual({
    feeUsd: '25.00',
    wallet,
    availableUsd: '100.00',
    availableAfterUsd: '75.00',
    disabledReason: null,
  });
  expect(vaOpeningFeeQuote({ ...channel, openingFeeUsd: null }, [wallet]).disabledReason).toBe(
    'fee_not_configured'
  );
  expect(vaOpeningFeeQuote(channel, []).disabledReason).toBe('usd_wallet_missing');
  expect(
    vaOpeningFeeQuote(channel, [{ ...wallet, availableBalance: '20.00' }]).disabledReason
  ).toBe('insufficient_balance');
});
