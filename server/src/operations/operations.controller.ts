import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  AdjustmentDirection,
  Currency,
  OperationStatus,
  OperationType,
  PayoutMethod,
} from '@prisma/client';
import type { Request } from 'express';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { currentUserId } from '../common/current-user';
import { OperationsService } from './operations.service';

class CreateOperationDto {
  @IsString() customerId!: string;
  @IsEnum(OperationType) type!: OperationType;
  @IsEnum(Currency) currency!: Currency;
  @IsNumberString() amount!: string;
  @IsOptional() @IsNumberString() feeAmount?: string;
  @IsOptional() @IsNumberString() expectedFeeAmount?: string;
  @IsOptional() @IsString() expectedFeeRuleVersion?: string;
  @IsOptional() @IsString() sourceAccountId?: string;
  @IsOptional() @IsString() targetAccountId?: string;
  @IsOptional() @IsString() beneficiaryId?: string;
  @IsOptional() @IsString() channelId?: string;
  @IsOptional() @IsEnum(PayoutMethod) payoutMethod?: PayoutMethod;
  @IsOptional() @IsEnum(AdjustmentDirection) adjustmentDirection?: AdjustmentDirection;
  @IsOptional() @IsEnum(Currency) quoteCurrency?: Currency;
  @IsOptional() @IsString() narrative?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsOptional() @IsString() remitterName?: string;
  @IsOptional() @IsString() remitterBank?: string;
  @IsOptional() @IsString() remittanceReference?: string;
  @IsOptional() @IsISO8601() receivedAt?: string;
  @IsOptional() @IsString() proofUrl?: string;
  @IsOptional() @IsString() marketProvider?: string;
  @IsOptional() @IsString() marketPriceType?: string;
  @IsOptional() @IsBoolean() marketReferenceOnly?: boolean;
  @IsOptional() @IsNumberString() marketRate?: string;
  @IsOptional() @IsISO8601() marketUpdatedAt?: string;
  @IsOptional() @IsISO8601() marketFetchedAt?: string;
}

class RejectOperationDto {
  @IsString() reason!: string;
}

class ExecuteOperationDto {
  @IsString() externalReference!: string;
}

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('status') status?: OperationStatus,
    @Query('type') type?: OperationType,
    @Query('customerId') customerId?: string
  ) {
    return this.operations.list(
      { organizationId, status, type, customerId },
      currentUserId(request)
    );
  }

  @Get('approvals')
  approvals(@Query('organizationId') organizationId: string, @Req() request: Request) {
    return this.operations.approvals(organizationId, currentUserId(request));
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: Request) {
    return this.operations.get(id, currentUserId(request));
  }

  @Post()
  create(@Body() dto: CreateOperationDto, @Req() request: Request) {
    return this.operations.create(dto, currentUserId(request));
  }

  @Post('quote')
  createQuote(@Body() dto: CreateOperationDto, @Req() request: Request) {
    return this.operations.createQuote(dto, currentUserId(request), customerQuoteActor(request));
  }

  @Post(':id/confirm')
  confirmQuote(@Param('id') id: string, @Req() request: Request) {
    return this.operations.confirmQuote(id, customerQuoteActor(request));
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Req() request: Request) {
    return this.operations.approve(id, currentUserId(request));
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectOperationDto, @Req() request: Request) {
    return this.operations.reject(id, dto.reason, currentUserId(request));
  }

  @Patch(':id/execute')
  execute(@Param('id') id: string, @Body() dto: ExecuteOperationDto, @Req() request: Request) {
    return this.operations.execute(id, dto.externalReference, currentUserId(request));
  }
}

function customerQuoteActor(request: Request) {
  const customerId = request.header('x-authenticated-customer-id')?.trim() || '';
  const email = request.header('x-authenticated-email')?.trim() || undefined;
  return { customerId, email };
}
