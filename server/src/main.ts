import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({
    origin: (
      process.env.WEB_ORIGIN ||
      'http://localhost:3002,http://localhost:8787,http://127.0.0.1:8787'
    ).split(','),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT || 4000), '0.0.0.0');
}

void bootstrap();
