import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DepositAccountingWorkerModule } from './deposit-accounting-worker.module';
import { DepositAccountingWorker } from './deposit-accounting.worker';
import { WithdrawalAccountingWorker } from './withdrawal-accounting.worker';

async function bootstrap() {
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
