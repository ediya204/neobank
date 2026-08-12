import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Currency, RateType } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

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
  list(@Query('type') type?: RateType) {
    return this.db.rateVersion.findMany({
      where: type ? { type } : {},
      orderBy: [{ effectiveFrom: 'desc' }, { baseCurrency: 'asc' }],
    });
  }

  @Post()
  async create(@Body() dto: CreateRateDto) {
    return this.db.$transaction(async (tx) => {
      await tx.rateVersion.updateMany({
        where: { type: dto.type, baseCurrency: dto.baseCurrency, quoteCurrency: dto.quoteCurrency, active: true },
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
}
