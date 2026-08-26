/* eslint-env jest, node */

const { readFileSync } = require('fs');
const { resolve } = require('path');

function source(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

function section(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return text.slice(startIndex, endIndex);
}

describe('VA 银行地址展示', () => {
  it('客户账户资料弹窗展示银行地址', () => {
    const block = section(
      source('src/pages/portal/customer-accounts.tsx'),
      'function AccountDialog(',
      'function Detail('
    );

    expect(block).toContain("label={portalText('银行地址')}");
    expect(block).toContain("value={account.bankAddress || '-'}");
  });

  it('VA 转入页面展示银行地址', () => {
    const block = section(
      source('src/pages/portal/fiat-deposit.tsx'),
      'function BankInstructionCard(',
      'function OtcDestination('
    );

    expect(block).toContain("label={portalText('银行地址')}");
    expect(block).toContain("value={account?.bankAddress || '—'}");
  });

  it('复制 VA 转入资料时包含银行地址', () => {
    const block = section(
      source('src/pages/portal/fiat-deposit.tsx'),
      'function depositInstructionText(',
      '\n}'
    );

    // eslint-disable-next-line no-template-curly-in-string
    expect(block).toContain("`${portalText('银行地址')}: ${account.bankAddress || '—'}`");
  });

  it('后台客户详情 VA 卡片展示银行地址', () => {
    const block = section(
      source('src/pages/dashboard/customer-detail.tsx'),
      'function FiatAccountAsset(',
      'function CryptoWalletAsset('
    );

    expect(block).toContain('label="银行地址"');
    expect(block).toContain("value={account.bankAddress || '-'}");
  });
});
