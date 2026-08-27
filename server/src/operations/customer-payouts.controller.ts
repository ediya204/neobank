import { Body, Controller, Post, Req } from '@nestjs/common';
import { Currency, OperationType, PayoutMethod } from '@prisma/client';
import type { Request } from 'express';
import { IsEmail, IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';
import { currentUserId } from '../common/current-user';
import { OperationsService } from './operations.service';

class CreateCustomerPayoutDto {
  @IsString() customerId!: string;
  @IsEmail() customerEmail!: string;
  @IsEnum(Currency) currency!: Currency;
  @IsNumberString() amount!: string;
  @IsString() sourceAccountId!: string;
  @IsString() beneficiaryId!: string;
  @IsString() channelId!: string;
  @IsEnum(PayoutMethod) payoutMethod!: PayoutMethod;
  @IsNumberString() expectedFeeAmount!: string;
  @IsString() expectedFeeRuleVersion!: string;
  @IsString() idempotencyKey!: string;
  @IsOptional() @IsString() narrative?: string;
}

@Controller('internal/customer-payouts')
export class CustomerPayoutsController {
  constructor(private readonly operations: OperationsService) {}

  @Post()
  create(@Body() dto: CreateCustomerPayoutDto, @Req() request: Request) {
    return this.operations.createCustomerPayout(
      { ...dto, type: OperationType.PAYOUT, feeAmount: '0' },
      currentUserId(request),
      { customerId: dto.customerId, email: dto.customerEmail }
    );
  }
}
