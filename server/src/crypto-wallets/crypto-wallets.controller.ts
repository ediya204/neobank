import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CryptoNetwork, CryptoTransferDirection, CryptoTransferStatus } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { CryptoWalletsService } from './crypto-wallets.service';

class CreateWithdrawalDto {
  @IsString() customerId!: string;
  @IsString() walletId!: string;
  @IsEnum(CryptoNetwork) network!: CryptoNetwork;
  @IsNumberString() amount!: string;
  @IsString() toAddress!: string;
  @IsString() idempotencyKey!: string;
}

class RejectTransferDto {
  @IsString() reason!: string;
}

class ExecuteTransferDto {
  @IsString() txHash!: string;
}

@Controller('crypto-wallets')
export class CryptoWalletsController {
  constructor(private readonly wallets: CryptoWalletsService) {}

  @Get()
  listWallets(@Query('customerId') customerId: string) {
    return this.wallets.listWallets(customerId);
  }

  @Get('transfers')
  listTransfers(
    @Query('customerId') customerId: string,
    @Query('direction') direction?: CryptoTransferDirection,
    @Query('status') status?: CryptoTransferStatus
  ) {
    return this.wallets.listTransfers(customerId, direction, status);
  }

  @Get(':id/qr')
  qrCode(@Param('id') id: string, @Query('customerId') customerId: string) {
    return this.wallets.qrCode(id, customerId);
  }

  @Post('withdrawals')
  createWithdrawal(@Body() dto: CreateWithdrawalDto, @Req() request: Request) {
    return this.wallets.createWithdrawal(dto, currentUserId(request));
  }

  @Patch('transfers/:id/approve')
  approve(@Param('id') id: string, @Req() request: Request) {
    return this.wallets.approve(id, currentUserId(request));
  }

  @Patch('transfers/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectTransferDto, @Req() request: Request) {
    return this.wallets.reject(id, dto.reason, currentUserId(request));
  }

  @Patch('transfers/:id/execute')
  execute(@Param('id') id: string, @Body() dto: ExecuteTransferDto, @Req() request: Request) {
    return this.wallets.execute(id, dto.txHash, currentUserId(request));
  }
}
