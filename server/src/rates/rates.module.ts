import { Module } from '@nestjs/common';
import { RatesController } from './rates.controller';

@Module({ controllers: [RatesController] })
export class RatesModule {}
