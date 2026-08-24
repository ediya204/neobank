import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isFinancialAccountingProcessingEnabled } from '../dist/src/deposit-accounting/financial-accounting-mode.js';

test('financial accounting processing is fail-closed unless explicitly enabled', () => {
  assert.equal(isFinancialAccountingProcessingEnabled(), false);
  assert.equal(isFinancialAccountingProcessingEnabled(''), false);
  assert.equal(isFinancialAccountingProcessingEnabled('false'), false);
  assert.equal(isFinancialAccountingProcessingEnabled('0'), false);
  assert.equal(isFinancialAccountingProcessingEnabled('1'), false);
  assert.equal(isFinancialAccountingProcessingEnabled('yes'), false);
  assert.equal(isFinancialAccountingProcessingEnabled('true'), true);
  assert.equal(isFinancialAccountingProcessingEnabled(' TRUE '), true);
});

test('paused financial accounting process exits cleanly without initializing Prisma', async (t) => {
  let databaseConnections = 0;
  const databaseSentinel = createServer((socket) => {
    databaseConnections += 1;
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    databaseSentinel.once('error', fail);
    databaseSentinel.listen(0, '127.0.0.1', () => {
      databaseSentinel.off('error', fail);
      resolve();
    });
  });
  t.after(
    () =>
      new Promise((resolve) => {
        databaseSentinel.close(resolve);
      })
  );
  const sentinelAddress = databaseSentinel.address();
  assert.ok(sentinelAddress && typeof sentinelAddress !== 'string');

  const entrypoint = fileURLToPath(
    new URL('../dist/src/deposit-accounting/deposit-accounting-main.js', import.meta.url)
  );
  const child = spawn(process.execPath, [entrypoint], {
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://invalid:invalid@127.0.0.1:${sentinelAddress.port}/must_not_connect`,
      FINANCIAL_ACCOUNTING_PROCESSING_ENABLED: 'false',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  let output = '';
  const paused = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`paused log not observed: ${output}`)), 5000);
    const capture = (chunk) => {
      output += chunk.toString();
      if (output.includes('financial_accounting_worker_paused')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
  });

  await paused;
  await new Promise((resolve) => setTimeout(resolve, 3250));
  assert.equal(child.exitCode, null);
  assert.equal(databaseConnections, 0);
  assert.doesNotMatch(
    output,
    /deposit_accounting_worker_started|withdrawal_accounting_worker_started/
  );
  assert.equal(child.kill('SIGTERM'), true);
  const [code, signal] = await waitForChildClose(child, 5000);

  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.match(output, /financial_accounting_worker_paused/);
  assert.match(output, /financial_accounting_worker_stopped/);
  assert.doesNotMatch(output, /Prisma|P1001|deposit_accounting_worker_crashed/);
});

function waitForChildClose(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('financial accounting worker did not exit after SIGTERM'));
    }, timeoutMs);
    once(child, 'close').then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
