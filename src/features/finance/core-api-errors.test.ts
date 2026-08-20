import { apiErrorMessage } from './core-api';

it('translates customer Core authorization details into a recoverable customer message', () => {
  expect(apiErrorMessage(undefined, 'customer_core_route_forbidden', 403)).toBe(
    '账户资料暂时无法读取，请刷新账户或重新登录后重试。'
  );
});

it('preserves business errors that callers use for specific recovery flows', () => {
  expect(apiErrorMessage(undefined, 'quote_expired', 409)).toBe('quote_expired');
  expect(apiErrorMessage('报价已失效', 'quote_expired', 409)).toBe('报价已失效');
});
