import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Currency, Prisma, RateType, UserRole } from '@prisma/client';
import type { Request } from 'express';
import { IsDateString, IsEnum, IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';
import { currentUserId } from '../common/current-user';
import { requireActiveUser } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { supportedFiatCurrencies } from '../supported-assets';

class CreateRateDto {
  @IsEnum(RateType) type!: RateType;
  @IsEnum(Currency) baseCurrency!: Currency;
  @IsEnum(Currency) quoteCurrency!: Currency;
  @IsNumberString() buyRate!: string;
  @IsNumberString() sellRate!: string;
  @IsInt() @Min(0) @Max(10000) feeBps!: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveUntil?: string;
}

@Controller('rates')
export class RatesController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(@Req() request: Request, @Query('type') type?: RateType) {
    await requireActiveUser(this.db, currentUserId(request));
    return this.db.rateVersion.findMany({
      where: {
        ...(type ? { type } : {}),
        OR: [
          {
            baseCurrency: { in: supportedFiatCurrencies },
            quoteCurrency: { in: supportedFiatCurrencies },
          },
          { baseCurrency: 'USDT', quoteCurrency: { in: supportedFiatCurrencies } },
          { baseCurrency: { in: supportedFiatCurrencies }, quoteCurrency: 'USDT' },
        ],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { baseCurrency: 'asc' }],
    });
  }

  @Post()
  async create(@Req() request: Request, @Body() dto: CreateRateDto) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    const fiat = new Set<Currency>(supportedFiatCurrencies);
    if (dto.baseCurrency === dto.quoteCurrency) {
      throw new BadRequestException('rate_currencies_must_differ');
    }
    let buyRate: Prisma.Decimal;
    let sellRate: Prisma.Decimal;
    try {
      buyRate = new Prisma.Decimal(dto.buyRate);
      sellRate = new Prisma.Decimal(dto.sellRate);
    } catch {
      throw new BadRequestException('invalid_rate_value');
    }
    if (
      !buyRate.isFinite() ||
      !sellRate.isFinite() ||
      buyRate.lessThanOrEqualTo(0) ||
      sellRate.lessThanOrEqualTo(0)
    ) {
      throw new BadRequestException('rate_must_be_positive');
    }
    const isFx =
      dto.type === RateType.FX && fiat.has(dto.baseCurrency) && fiat.has(dto.quoteCurrency);
    const isOtc =
      dto.type === RateType.OTC &&
      ((dto.baseCurrency === Currency.USDT && fiat.has(dto.quoteCurrency)) ||
        (fiat.has(dto.baseCurrency) && dto.quoteCurrency === Currency.USDT));
    if (!isFx && !isOtc) throw new BadRequestException('unsupported_rate_pair');
    return this.db.$transaction(async (tx) => {
      await tx.rateVersion.updateMany({
        where: {
          type: dto.type,
          baseCurrency: dto.baseCurrency,
          quoteCurrency: dto.quoteCurrency,
          active: true,
        },
        data: { active: false, effectiveUntil: new Date(dto.effectiveFrom) },
      });
      return tx.rateVersion.create({
        data: {
          ...dto,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : undefined,
        },
      });
    });
  }

  @Patch(':id/deactivate')
  async deactivate(@Req() request: Request, @Param('id') id: string) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    const result = await this.db.rateVersion.updateMany({
      where: { id, active: true },
      data: { active: false, effectiveUntil: new Date() },
    });
    if (!result.count) throw new NotFoundException('active_rate_not_found');
    return this.db.rateVersion.findUniqueOrThrow({ where: { id } });
  }
}
