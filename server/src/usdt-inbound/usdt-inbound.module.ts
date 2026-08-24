import { Module } from '@nestjs/common';
import { UsdtInboundController } from './usdt-inbound.controller';
import { UsdtInboundService } from './usdt-inbound.service';

@Module({ controllers: [UsdtInboundController], providers: [UsdtInboundService] })
export class UsdtInboundModule {}
