import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from './customers.service';

class RejectVaRequestDto {
  @IsString() reason!: string;
}

@Controller('virtual-account-requests')
export class VirtualAccountsController {
  constructor(private readonly customers: CustomersService, private readonly db: PrismaService) {}

  @Get()
  list(@Query('organizationId') organizationId: string) {
    return this.db.virtualAccountRequest.findMany({
      where: { customer: { organizationId } },
      include: { customer: true, assignedAccount: true, maker: true, checker: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Req() request: Request) {
    return this.customers.approveVirtualAccountRequest(id, currentUserId(request));
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectVaRequestDto, @Req() request: Request) {
    return this.customers.rejectVirtualAccountRequest(id, checkerId(request), dto.reason);
  }
}

function checkerId(request: Request) {
  return currentUserId(request);
}
