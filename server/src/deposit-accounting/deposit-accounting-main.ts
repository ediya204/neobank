import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DepositAccountingWorkerModule } from './deposit-accounting-worker.module';
import { DepositAccountingWorker } from './deposit-accounting.worker';
import { isFinancialAccountingProcessingEnabled } from './financial-accounting-mode';
import { WithdrawalAccountingWorker } from './withdrawal-accounting.worker';

function waitForShutdownSignal() {
  return new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => undefined, 60_000);
    const stop = () => {
      clearInterval(keepAlive);
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
      resolve();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
}

async function bootstrap() {
  if (
    !isFinancialAccountingProcessingEnabled(process.env.FINANCIAL_ACCOUNTING_PROCESSING_ENABLED)
  ) {
    Logger.warn(
      JSON.stringify({
        event: 'financial_accounting_worker_paused',
        processing_enabled: false,
      })
    );
    await waitForShutdownSignal();
    Logger.log(
      JSON.stringify({
        event: 'financial_accounting_worker_stopped',
        mode: 'paused',
      })
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(DepositAccountingWorkerModule);
  const depositWorker = app.get(DepositAccountingWorker);
  const withdrawalWorker = app.get(WithdrawalAccountingWorker);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    depositWorker.stop();
    withdrawalWorker.stop();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await Promise.all([depositWorker.run(), withdrawalWorker.run()]);
  } finally {
    await app.close();
  }
}

bootstrap().catch((caught) => {
  Logger.error(
    JSON.stringify({
      event: 'deposit_accounting_worker_crashed',
      code: caught instanceof Error ? caught.message : 'unknown_error',
    })
  );
  process.exitCode = 1;
});
