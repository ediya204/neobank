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
import { BeneficiaryType, CryptoNetwork, Currency, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { currentUserId } from '../common/current-user';
import { requireActiveUser, requireCustomerAccess } from '../common/tenant-access';
import { isValidTronAddress } from '../crypto-wallets/tron-address';
import { PrismaService } from '../prisma/prisma.service';
import {
  isSupportedFiatCurrency,
  supportedCryptoAsset,
  supportedCryptoNetwork,
  supportedFiatCurrencies,
} from '../supported-assets';

class CreateBeneficiaryDto {
  @IsString() customerId!: string;
  @IsOptional() @IsEnum(BeneficiaryType) type?: BeneficiaryType;
  @IsString() name!: string;
  @IsEnum(Currency) currency!: Currency;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() bankAddress?: string;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @IsOptional() @IsString() walletAddress?: string;
  @IsOptional() @IsEnum(CryptoNetwork) network?: CryptoNetwork;
}

class UpdateBeneficiaryDto {
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(@Query('customerId') customerId: string, @Req() request: Request) {
    await requireCustomerAccess(this.db, currentUserId(request), customerId);
    return this.db.beneficiary.findMany({
      where: {
        customerId,
        OR: [
          { type: BeneficiaryType.BANK, currency: { in: supportedFiatCurrencies } },
          {
            type: BeneficiaryType.CRYPTO,
            currency: supportedCryptoAsset,
            network: supportedCryptoNetwork,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreateBeneficiaryDto, @Req() request: Request) {
    await requireCustomerAccess(this.db, currentUserId(request), dto.customerId);
    const type = dto.type || BeneficiaryType.BANK;
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('beneficiary_name_required');

    let data: Prisma.BeneficiaryUncheckedCreateInput;
    if (type === BeneficiaryType.BANK) {
      if (!isSupportedFiatCurrency(dto.currency)) {
        throw new BadRequestException('unsupported_fiat_currency');
      }
      const bankName = dto.bankName?.trim();
      const accountNumber = dto.accountNumber?.trim();
      const countryCode = dto.countryCode?.trim().toUpperCase();
      if (!bankName || !accountNumber || !countryCode) {
        throw new BadRequestException('bank_beneficiary_details_required');
      }
      data = {
        customerId: dto.customerId,
        type,
        name,
        currency: dto.currency,
        bankName,
        accountNumber,
        swiftBic: dto.swiftBic?.trim().toUpperCase() || null,
        iban: dto.iban?.trim().toUpperCase() || null,
        bankAddress: dto.bankAddress?.trim() || null,
        countryCode,
      };
    } else {
      const walletAddress = dto.walletAddress?.trim();
      if (
        dto.currency !== supportedCryptoAsset ||
        dto.network !== supportedCryptoNetwork ||
        !walletAddress
      ) {
        throw new BadRequestException('unsupported_crypto_beneficiary');
      }
      if (!isValidTronAddress(walletAddress)) {
        throw new BadRequestException('invalid_tron_address');
      }
      data = {
        customerId: dto.customerId,
        type,
        name,
        currency: supportedCryptoAsset,
        network: supportedCryptoNetwork,
        walletAddress,
      };
    }

    try {
      return await this.db.beneficiary.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('beneficiary_already_exists');
      }
      throw error;
    }
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
    if (dto.active === undefined) {
      throw new BadRequestException('beneficiary_destination_immutable');
    }
    return this.db.beneficiary.update({ where: { id }, data: { active: dto.active } });
  }
}
