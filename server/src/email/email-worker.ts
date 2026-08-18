import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EmailDeliveryWorker } from './email-delivery.worker';
import { EmailWorkerModule } from './email-worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(EmailWorkerModule);
  const worker = app.get(EmailDeliveryWorker);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    worker.stop();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await worker.run();
  } finally {
    await app.close();
  }
}

bootstrap().catch((caught) => {
  Logger.error(
    JSON.stringify({
      event: 'email_worker_crashed',
      code: caught instanceof Error ? caught.message : 'unknown_error',
    })
  );
  process.exitCode = 1;
});
