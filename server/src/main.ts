import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json as expressJson, urlencoded as expressUrlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { edgeAuthMiddleware } from './security/edge-auth';

async function bootstrap() {
  const edgeSecret = process.env.CORE_EDGE_SHARED_SECRET || '';
  const accountingSecret = process.env.CORE_ACCOUNTING_SHARED_SECRET || '';
  const adminUserId = process.env.CORE_ADMIN_USER_ID || '';
  const edgeAuthRequired = process.env.CORE_EDGE_AUTH_REQUIRED === 'true';
  const directAccountingEnabled =
    process.env.CREGIS_DIRECT_ACCOUNTING_ENABLED?.trim().toLowerCase() === 'true';
  if (directAccountingEnabled && Buffer.byteLength(accountingSecret) < 32) {
    throw new Error(
      'CORE_ACCOUNTING_SHARED_SECRET must be at least 32 bytes when direct accounting is enabled'
    );
  }
  if (directAccountingEnabled && accountingSecret === edgeSecret) {
    throw new Error('CORE_ACCOUNTING_SHARED_SECRET must differ from CORE_EDGE_SHARED_SECRET');
  }
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  const captureRawBody = (
    request: IncomingMessage & { rawBody?: Buffer },
    _response: ServerResponse,
    buffer: Buffer
  ) => {
    request.rawBody = Buffer.from(buffer);
  };
  app.use(expressJson({ limit: '128kb', verify: captureRawBody }));
  app.use(expressUrlencoded({ extended: true, limit: '128kb', verify: captureRawBody }));
  if (edgeAuthRequired || edgeSecret || accountingSecret || adminUserId) {
    app.use(edgeAuthMiddleware({ secret: edgeSecret, accountingSecret, adminUserId }));
  }
  app.enableCors({
    origin: (
      process.env.WEB_ORIGIN || 'http://localhost:3002,http://localhost:8787,http://127.0.0.1:8787'
    ).split(','),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT || 4000), '0.0.0.0');
}

void bootstrap();
