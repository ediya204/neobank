import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { Currency, CustomerStatus, CustomerType } from '@prisma/client';
import { CustomersService } from './customers.service';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';

class CreateCustomerDto {
  @IsString() organizationId!: string;
  @IsEnum(CustomerType) type!: CustomerType;
  @IsString() displayName!: string;
  @IsString() legalName!: string;
  @IsEmail() email!: string;
  @IsString() @Length(2, 2) countryCode!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() registrationNo?: string;
}

class ReviewCustomerDto {
  @IsOptional() @IsString() note?: string;
}

class RejectCustomerDto {
  @IsString() reason!: string;
}

class CreateVaRequestDto {
  @IsEnum(Currency) currency!: Currency;
  @IsString() @Length(2, 2) preferredCountry!: string;
  @IsString() purpose!: string;
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query('organizationId') organizationId: string, @Query('status') status?: CustomerStatus) {
    return this.customers.list(organizationId, status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @Req() request: Request) {
    return this.customers.create(dto, currentUserId(request));
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ReviewCustomerDto, @Req() request: Request) {
    return this.customers.approve(id, currentUserId(request), dto.note);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectCustomerDto, @Req() request: Request) {
    return this.customers.reject(id, currentUserId(request), dto.reason);
  }

  @Post(':id/virtual-account-requests')
  requestVa(@Param('id') id: string, @Body() dto: CreateVaRequestDto, @Req() request: Request) {
    return this.customers.requestVirtualAccount(id, dto, currentUserId(request));
  }

  @Get(':id/virtual-account-requests')
  listVaRequests(@Param('id') id: string) {
    return this.customers.listVirtualAccountRequests(id);
  }
}
