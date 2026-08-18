import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from './email.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, EmailModule] })
export class EmailWorkerModule {}
