import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { UsdtInboundService } from './usdt-inbound.service';

@Controller('usdt-inbound')
export class UsdtInboundController {
  constructor(private readonly inbound: UsdtInboundService) {}

  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.inbound.list(
      {
        organizationId,
        source,
        status,
        customerId,
        search,
        limit: limit === undefined ? undefined : Number(limit),
        offset: offset === undefined ? undefined : Number(offset),
      },
      currentUserId(request)
    );
  }
}
