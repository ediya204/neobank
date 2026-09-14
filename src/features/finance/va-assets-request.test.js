/* eslint-env jest, node */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import * as mui from '@mui/material';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';
import { vaOpeningFeeQuote } from './core-api';

// Exercise the actual private dialog without importing the unrelated assets dashboard.
const source = readFileSync(
  resolvePath(process.cwd(), 'src/pages/portal/customer-accounts.tsx'),
  'utf8'
);
const dialogSource = source.slice(
  source.indexOf('function VaRequestDialog('),
  source.indexOf('function AccountListRow(')
);
const compiled = ts.transpileModule(dialogSource, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText;
const api = jest.fn();
const dependencies = {
  React,
  ...React,
  ...mui,
  crypto: { randomUUID: () => 'test-idempotency-key' },
  coreApi: api,
  demoOrganizationId: 'org-test',
  vaOpeningFeeQuote,
  portalText: (key) => key,
  accountBalanceLabel: () => 'USD wallet',
};
const Dialog = runInNewContext(`${compiled}; VaRequestDialog;`, dependencies);
const bank = {
  id: 'bank',
  type: 'VIRTUAL_ACCOUNT',
  name: 'Test bank',
  active: true,
  supportedCurrencies: ['USD'],
  openingFeeUsd: '25.00',
  openingFeeVersion: '1',
};
let root;
let container;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  api.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const submitButton = () => document.querySelector('button[type="submit"]');
const submit = () =>
  act(async () => {
    document
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

it.each([
  ['internal', '0.00', 1, []],
  ['special', '0.00', 3, []],
  [
    'restored standard',
    '25.00',
    4,
    [
      {
        id: 'wallet',
        kind: 'SYSTEM_WALLET',
        status: 'ACTIVE',
        currency: 'USD',
        availableBalance: '100',
      },
    ],
  ],
])(
  'assets dialog submits server-confirmed fees for %s customers',
  async (_label, feeUsd, version, accounts) => {
    const created = jest.fn();
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return { id: 'request' };
      if (path.includes('/va-opening-fee-quote'))
        return {
          channelId: bank.id,
          feeUsd,
          exempt: feeUsd === '0.00',
          openingFeeVersion: '2',
          feePolicyVersion: version,
        };
      return [bank];
    });
    await act(async () =>
      root.render(
        React.createElement(Dialog, {
          open: true,
          customerId: 'customer',
          accounts,
          onClose: () => {},
          onCreated: created,
        })
      )
    );
    expect(api.mock.calls.some(([path]) => path.includes('/va-opening-fee-quote'))).toBe(true);
    expect(submitButton().disabled).toBe(false);
    await submit();
    const writes = api.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toMatchObject({
      expectedOpeningFeeUsd: feeUsd,
      expectedOpeningFeeVersion: '2',
      expectedFeePolicyVersion: version,
    });
    expect(created).toHaveBeenCalledTimes(1);
  }
);

it('refreshes a rejected quote without automatically resubmitting or using an old fee', async () => {
  let quoteCount = 0;
  let resolveQuote;
  api.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') throw new Error('virtual_account_opening_fee_changed');
    if (path.includes('/va-opening-fee-quote')) {
      quoteCount += 1;
      if (quoteCount === 1)
        return {
          channelId: bank.id,
          feeUsd: '0.00',
          exempt: true,
          openingFeeVersion: '2',
          feePolicyVersion: 1,
        };
      return new Promise((resolve) => {
        resolveQuote = resolve;
      });
    }
    return [bank];
  });
  await act(async () =>
    root.render(
      React.createElement(Dialog, {
        open: true,
        customerId: 'customer',
        accounts: [],
        onClose: () => {},
        onCreated: () => {},
      })
    )
  );
  expect(submitButton().disabled).toBe(false);
  await submit();
  expect(quoteCount).toBe(2);
  expect(submitButton().disabled).toBe(true);
  await act(async () =>
    resolveQuote({
      channelId: bank.id,
      feeUsd: '25.00',
      exempt: false,
      openingFeeVersion: '2',
      feePolicyVersion: 2,
    })
  );
  expect(submitButton().disabled).toBe(true);
  expect(api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
