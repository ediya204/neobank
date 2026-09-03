import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Currency, CustomerStatus, CustomerType } from '@prisma/client';
import { CustomersService } from './customers.service';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';

class CreateCustomerDto {
  @IsString() organizationId!: string;
  @IsEnum(CustomerType) type!: CustomerType;
  @IsString() @Length(1, 160) displayName!: string;
  @IsString() @Length(1, 180) legalName!: string;
  @IsEmail() email!: string;
  @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode!: string;
  @IsString() @Matches(/^[0-9 ()-]{6,24}$/) phone!: string;
  @IsString() @Matches(/^\+[1-9][0-9]{0,3}$/) phoneCountryCode!: string;
  @ValidateIf((input: CreateCustomerDto) => input.type === CustomerType.BUSINESS)
  @IsString()
  @Length(1, 80)
  registrationNo?: string;
  @ValidateIf((input: CreateCustomerDto) => input.type === CustomerType.INDIVIDUAL)
  @IsDateString()
  dateOfBirth?: string;
  @ValidateIf((input: CreateCustomerDto) => input.type === CustomerType.INDIVIDUAL)
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  nationality?: string;
  @ValidateIf((input: CreateCustomerDto) => input.type === CustomerType.BUSINESS)
  @IsString()
  @Length(1, 120)
  contactName?: string;
  @ValidateIf((input: CreateCustomerDto) => input.type === CustomerType.BUSINESS)
  @IsString()
  @Length(1, 100)
  contactRole?: string;
  @ValidateIf((input: CreateCustomerDto) => input.type === CustomerType.BUSINESS)
  @IsString()
  @Length(1, 120)
  beneficialOwnerName?: string;
  @ValidateIf((input: CreateCustomerDto) => input.type === CustomerType.BUSINESS)
  @IsNumber()
  @Min(0.01)
  @Max(100)
  beneficialOwnerOwnership?: number;
}

class ReviewCustomerDto {
  @IsOptional() @IsString() note?: string;
}

class RejectCustomerDto {
  @IsString() reason!: string;
}

enum KycDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

class ReviewKycDto {
  @IsEnum(KycDecision) decision!: KycDecision;
  @IsOptional() @IsString() note?: string;
}

class CreateVaRequestDto {
  @IsEnum(Currency) currency!: Currency;
  @IsString() channelId!: string;
  @IsString() @Length(2, 500) purpose!: string;
  @IsOptional() @IsNumberString() expectedOpeningFeeUsd?: string;
  @IsOptional() @IsString() expectedOpeningFeeVersion?: string;
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('status') status?: CustomerStatus
  ) {
    return this.customers.list(organizationId, currentUserId(request), status);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: Request) {
    return this.customers.get(id, currentUserId(request));
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @Req() request: Request) {
    return this.customers.create(dto, currentUserId(request));
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ReviewCustomerDto, @Req() request: Request) {
    return this.customers.approve(id, currentUserId(request), dto.note);
  }

  @Patch(':id/kyc')
  reviewKyc(@Param('id') id: string, @Body() dto: ReviewKycDto, @Req() request: Request) {
    return this.customers.reviewKyc(id, currentUserId(request), dto.decision, dto.note);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectCustomerDto, @Req() request: Request) {
    return this.customers.reject(id, currentUserId(request), dto.reason);
  }

  @Post(':id/virtual-account-requests')
  requestVa(@Param('id') id: string, @Body() dto: CreateVaRequestDto, @Req() request: Request) {
    const idempotencyKey = request.header('idempotency-key')?.trim();
    if (idempotencyKey && idempotencyKey.length > 128) {
      throw new BadRequestException('invalid_idempotency_key');
    }
    return this.customers.requestVirtualAccount(
      id,
      { ...dto, idempotencyKey },
      requestActor(request)
    );
  }

  @Get(':id/virtual-account-requests')
  listVaRequests(@Param('id') id: string, @Req() request: Request) {
    return this.customers.listVirtualAccountRequests(id, requestActor(request));
  }
}

function requestActor(request: Request) {
  return {
    userId: currentUserId(request),
    customerId: request.header('x-authenticated-customer-id')?.trim() || undefined,
    email: request.header('x-authenticated-email')?.trim().toLowerCase() || undefined,
  };
}
