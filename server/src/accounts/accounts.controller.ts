import { Controller, Get, Param, Query } from '@nestjs/common';
import { AccountKind } from '@prisma/client';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Query('customerId') customerId: string, @Query('kind') kind?: AccountKind) {
    return this.accounts.list(customerId, kind);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.accounts.get(id);
  }
}
