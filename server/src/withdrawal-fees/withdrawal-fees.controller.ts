import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import {
  WithdrawalAssetClass,
  WithdrawalFeesService,
  WithdrawalMethod,
  withdrawalAssetClasses,
  withdrawalMethods,
} from './withdrawal-fees.service';

class UpsertWithdrawalFeeDto {
  @IsString() organizationId!: string;
  @IsIn(withdrawalAssetClasses) assetClass!: WithdrawalAssetClass;
  @IsEnum(Currency) currency!: Currency;
  @IsIn(withdrawalMethods) method!: WithdrawalMethod;
  @IsString() channelCode!: string;
  @IsOptional() @IsString() network?: string;
  @IsNumberString() amount!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateWithdrawalFeeDto {
  @IsOptional() @IsNumberString() amount?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsString() version!: string;
}

@Controller('withdrawal-fees')
export class WithdrawalFeesController {
  constructor(private readonly fees: WithdrawalFeesService) {}

  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('active') active?: string
  ) {
    if (active !== undefined && active !== 'true' && active !== 'false') {
      throw new BadRequestException('invalid_active_filter');
    }
    return this.fees.list(
      organizationId,
      currentUserId(request),
      active === undefined ? undefined : active === 'true'
    );
  }

  @Post()
  upsert(@Body() dto: UpsertWithdrawalFeeDto, @Req() request: Request) {
    return this.fees.upsert(dto, currentUserId(request));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWithdrawalFeeDto, @Req() request: Request) {
    return this.fees.update(id, dto, currentUserId(request));
  }
}
