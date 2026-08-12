import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { AccountKind } from '@prisma/client';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(
    @Query('customerId') customerId: string,
    @Req() request: Request,
    @Query('kind') kind?: AccountKind
  ) {
    return this.accounts.list(customerId, currentUserId(request), kind);
  }

  @Get('summary')
  summary(@Query('customerId') customerId: string, @Req() request: Request) {
    return this.accounts.summary(customerId, currentUserId(request));
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: Request) {
    return this.accounts.get(id, currentUserId(request));
  }
}
