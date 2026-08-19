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
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { currentUserId } from '../common/current-user';
import { requireActiveUser } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { supportedFiatCurrencies } from '../supported-assets';

class CreateMarketRateDto {
  @IsEnum(RateType) type!: RateType;
  @IsEnum(Currency) baseCurrency!: Currency;
  @IsEnum(Currency) quoteCurrency!: Currency;
  @IsInt() @Min(0) @Max(9999) feeBps!: number;
  @IsString() provider!: string;
  @IsString() priceType!: string;
  @IsBoolean() referenceOnly!: boolean;
  @IsNumberString() referenceRate!: string;
  @IsDateString() sourceUpdatedAt!: string;
  @IsDateString() sourceFetchedAt!: string;
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
  async rejectManualCreate(@Req() request: Request) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    throw new BadRequestException('manual_rate_creation_disabled');
  }

  @Post('from-market')
  async createFromMarket(@Req() request: Request, @Body() dto: CreateMarketRateDto) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    if (
      dto.provider !== 'fastforex' ||
      dto.priceType !== 'midpoint_spot' ||
      dto.referenceOnly !== true
    ) {
      throw new BadRequestException('invalid_market_rate_source');
    }
    const fiat = new Set<Currency>(supportedFiatCurrencies);
    if (dto.baseCurrency === dto.quoteCurrency) {
      throw new BadRequestException('rate_currencies_must_differ');
    }
    let referenceRate: Prisma.Decimal;
    try {
      referenceRate = new Prisma.Decimal(dto.referenceRate);
    } catch {
      throw new BadRequestException('invalid_rate_value');
    }
    if (!referenceRate.isFinite() || referenceRate.lessThanOrEqualTo(0)) {
      throw new BadRequestException('rate_must_be_positive');
    }
    const isFx =
      dto.type === RateType.FX && fiat.has(dto.baseCurrency) && fiat.has(dto.quoteCurrency);
    const isOtc =
      dto.type === RateType.OTC &&
      ((dto.baseCurrency === Currency.USDT && fiat.has(dto.quoteCurrency)) ||
        (fiat.has(dto.baseCurrency) && dto.quoteCurrency === Currency.USDT));
    if (!isFx && !isOtc) throw new BadRequestException('unsupported_rate_pair');
    const sourceFetchedAt = new Date(dto.sourceFetchedAt);
    const sourceUpdatedAt = new Date(dto.sourceUpdatedAt);
    const now = Date.now();
    if (
      !Number.isFinite(sourceFetchedAt.getTime()) ||
      !Number.isFinite(sourceUpdatedAt.getTime()) ||
      sourceFetchedAt.getTime() < now - 2 * 60 * 1000 ||
      sourceFetchedAt.getTime() > now + 30 * 1000 ||
      sourceUpdatedAt.getTime() > now + 30 * 1000
    ) {
      throw new BadRequestException('stale_market_rate_source');
    }
    return this.db.$transaction(async (tx) => {
      const candidates = await tx.rateVersion.findMany({
        where: {
          type: dto.type,
          baseCurrency: dto.baseCurrency,
          quoteCurrency: dto.quoteCurrency,
          feeBps: dto.feeBps,
          active: true,
        },
      });
      const duplicate = candidates.find((candidate) =>
        candidate.buyRate.equals(candidate.sellRate)
      );
      if (duplicate) return duplicate;
      await tx.rateVersion.updateMany({
        where: {
          type: dto.type,
          baseCurrency: dto.baseCurrency,
          quoteCurrency: dto.quoteCurrency,
          active: true,
        },
        data: { active: false, effectiveUntil: new Date() },
      });
      return tx.rateVersion.create({
        data: {
          type: dto.type,
          baseCurrency: dto.baseCurrency,
          quoteCurrency: dto.quoteCurrency,
          buyRate: referenceRate,
          sellRate: referenceRate,
          feeBps: dto.feeBps,
          // buyRate/sellRate retain only the provider quote observed when the
          // fee policy was created. Runtime pricing never reads this snapshot.
          effectiveFrom: new Date(),
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
