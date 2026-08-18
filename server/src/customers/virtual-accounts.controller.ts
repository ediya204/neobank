import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from './customers.service';

class RejectVaRequestDto {
  @IsString() @Length(2, 500) reason!: string;
}

class ApproveVaRequestDto {
  @IsString() @Length(2, 160) accountName!: string;
  @IsString() @Length(4, 80) accountNumber!: string;
  @IsOptional() @IsString() @Length(4, 80) iban?: string;
}

@Controller('virtual-account-requests')
export class VirtualAccountsController {
  constructor(private readonly customers: CustomersService, private readonly db: PrismaService) {}

  @Get()
  async list(@Query('organizationId') organizationId: string, @Req() request: Request) {
    await requireOrganizationAccess(this.db, currentUserId(request), organizationId);
    return this.db.virtualAccountRequest.findMany({
      where: { customer: { organizationId } },
      include: { customer: true, channel: true, assignedAccount: true, maker: true, checker: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveVaRequestDto,
    @Req() request: Request
  ) {
    return this.customers.approveVirtualAccountRequest(id, dto, currentUserId(request));
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectVaRequestDto, @Req() request: Request) {
    return this.customers.rejectVirtualAccountRequest(id, checkerId(request), dto.reason);
  }
}

function checkerId(request: Request) {
  return currentUserId(request);
}
