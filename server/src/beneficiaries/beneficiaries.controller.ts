import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Currency } from '@prisma/client';
import type { Request } from 'express';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { currentUserId } from '../common/current-user';
import { requireActiveUser, requireCustomerAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { isSupportedFiatCurrency, supportedFiatCurrencies } from '../supported-assets';

class CreateBeneficiaryDto {
  @IsString() customerId!: string;
  @IsString() name!: string;
  @IsEnum(Currency) currency!: Currency;
  @IsString() bankName!: string;
  @IsString() accountNumber!: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() bankAddress?: string;
  @IsString() @Length(2, 2) countryCode!: string;
}

class UpdateBeneficiaryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() bankAddress?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(@Query('customerId') customerId: string, @Req() request: Request) {
    await requireCustomerAccess(this.db, currentUserId(request), customerId);
    return this.db.beneficiary.findMany({
      where: { customerId, currency: { in: supportedFiatCurrencies } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreateBeneficiaryDto, @Req() request: Request) {
    await requireCustomerAccess(this.db, currentUserId(request), dto.customerId);
    if (!isSupportedFiatCurrency(dto.currency)) {
      throw new BadRequestException('unsupported_fiat_currency');
    }
    return this.db.beneficiary.create({ data: dto });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBeneficiaryDto,
    @Req() request: Request
  ) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    const beneficiary = await this.db.beneficiary.findUnique({
      where: { id },
      include: { customer: { select: { organizationId: true } } },
    });
    if (!beneficiary || beneficiary.customer.organizationId !== user.organizationId) {
      throw new NotFoundException('beneficiary_not_found');
    }
    return this.db.beneficiary.update({ where: { id }, data: dto });
  }
}
