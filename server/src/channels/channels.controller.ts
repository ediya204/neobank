import {
  BadRequestException,
  Body,
  ConflictException,
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
import { ChannelType, Currency, Prisma, UserRole } from '@prisma/client';
import type { Request } from 'express';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { currentUserId } from '../common/current-user';
import { requireActiveUser, requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { supportedFiatCurrencies } from '../supported-assets';

class CreateChannelDto {
  @IsString() organizationId!: string;
  @IsString()
  @Length(3, 40)
  @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
  code!: string;
  @IsString() @Length(2, 80) name!: string;
  @IsEnum(ChannelType) type!: ChannelType;
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Currency, { each: true })
  supportedCurrencies!: Currency[];
  @IsOptional() @IsString() settlementBankName?: string;
  @IsOptional() @IsString() settlementAccount?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) bankCountry?: string;
  @IsOptional() @IsString() @Length(2, 300) bankAddress?: string;
  @IsOptional() @IsString() @Length(2, 120) branchName?: string;
}

class UpdateChannelDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(Currency, { each: true })
  supportedCurrencies?: Currency[];
  @IsOptional() @IsString() settlementBankName?: string;
  @IsOptional() @IsString() settlementAccount?: string;
  @IsOptional() @IsString() swiftBic?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) bankCountry?: string;
  @IsOptional() @IsString() @Length(2, 300) bankAddress?: string;
  @IsOptional() @IsString() @Length(2, 120) branchName?: string;
}

@Controller('funding-channels')
export class ChannelsController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('type') type?: ChannelType,
    @Query('active') active?: string
  ) {
    await requireOrganizationAccess(this.db, currentUserId(request), organizationId);
    const customerId = request.header('x-authenticated-customer-id')?.trim();
    const customerReadableTypes: ChannelType[] = [
      ChannelType.VIRTUAL_ACCOUNT,
      ChannelType.FIAT_INBOUND,
      ChannelType.POBO_PAYOUT,
      ChannelType.PLATFORM_PAYOUT,
    ];
    if (customerId && (!type || !customerReadableTypes.includes(type))) {
      throw new ForbiddenException('customer_readable_channels_only');
    }
    if (active !== undefined && active !== 'true' && active !== 'false') {
      throw new BadRequestException('invalid_active_filter');
    }
    const channels = await this.db.fundingChannel.findMany({
      where: {
        organizationId,
        ...(type ? { type } : {}),
        ...(customerId
          ? { active: true }
          : active !== undefined
          ? { active: active === 'true' }
          : {}),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return channels
      .map((channel) => {
        const supportedCurrencies = channel.supportedCurrencies.filter((currency) =>
          supportedFiatCurrencies.includes(currency as (typeof supportedFiatCurrencies)[number])
        );
        if (!customerId) return { ...channel, supportedCurrencies };
        return {
          id: channel.id,
          code: channel.code,
          name: channel.name,
          type: channel.type,
          supportedCurrencies,
          active: channel.active,
          settlementBankName: channel.settlementBankName,
          ...(channel.type === ChannelType.FIAT_INBOUND
            ? { settlementAccount: channel.settlementAccount }
            : {}),
          swiftBic: channel.swiftBic,
          bankCountry: channel.bankCountry,
          bankAddress: channel.bankAddress,
        };
      })
      .filter((channel) => channel.supportedCurrencies.length > 0);
  }

  @Post()
  async create(@Body() dto: CreateChannelDto, @Req() request: Request) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    if (user.organizationId !== dto.organizationId) {
      throw new ForbiddenException('organization_access_denied');
    }
    if (dto.type === ChannelType.VA_PAYOUT) {
      throw new BadRequestException('va_payout_channel_merged');
    }
    if (
      dto.type === ChannelType.VIRTUAL_ACCOUNT &&
      (this.optionalText(dto.settlementAccount) || this.optionalText(dto.branchName))
    ) {
      throw new BadRequestException('virtual_account_channel_customer_details_not_allowed');
    }
    this.assertSupportedCurrencies(dto.supportedCurrencies);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('funding_channel_name_required');
    try {
      return await this.db.fundingChannel.create({
        data: {
          organizationId: dto.organizationId,
          code: dto.code.trim().toUpperCase(),
          name,
          type: dto.type,
          supportedCurrencies: dto.supportedCurrencies,
          active: false,
          settlementBankName: this.optionalText(dto.settlementBankName),
          settlementAccount: this.optionalText(dto.settlementAccount),
          swiftBic: this.optionalText(dto.swiftBic)?.toUpperCase(),
          bankCountry: this.optionalText(dto.bankCountry)?.toUpperCase(),
          bankAddress: this.optionalText(dto.bankAddress),
          branchName: this.optionalText(dto.branchName),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('funding_channel_code_exists');
      }
      throw error;
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateChannelDto, @Req() request: Request) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    const channel = await this.db.fundingChannel.findUnique({
      where: { id },
      select: {
        organizationId: true,
        type: true,
        active: true,
        settlementBankName: true,
        settlementAccount: true,
        swiftBic: true,
        bankCountry: true,
        bankAddress: true,
        branchName: true,
      },
    });
    if (!channel || channel.organizationId !== user.organizationId) {
      throw new NotFoundException('funding_channel_not_found');
    }
    if (channel.type === ChannelType.VA_PAYOUT && dto.active === true) {
      throw new BadRequestException('va_payout_channel_merged');
    }
    if (
      channel.type === ChannelType.VIRTUAL_ACCOUNT &&
      (this.optionalText(dto.settlementAccount) || this.optionalText(dto.branchName))
    ) {
      throw new BadRequestException('virtual_account_channel_customer_details_not_allowed');
    }
    if (dto.supportedCurrencies) this.assertSupportedCurrencies(dto.supportedCurrencies);
    const data = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...(dto.supportedCurrencies !== undefined
        ? { supportedCurrencies: dto.supportedCurrencies }
        : {}),
      ...(dto.settlementBankName !== undefined
        ? { settlementBankName: this.optionalText(dto.settlementBankName) }
        : {}),
      ...(dto.settlementAccount !== undefined
        ? { settlementAccount: this.optionalText(dto.settlementAccount) }
        : {}),
      ...(dto.swiftBic !== undefined
        ? { swiftBic: this.optionalText(dto.swiftBic)?.toUpperCase() }
        : {}),
      ...(dto.bankCountry !== undefined
        ? { bankCountry: this.optionalText(dto.bankCountry)?.toUpperCase() }
        : {}),
      ...(dto.bankAddress !== undefined ? { bankAddress: this.optionalText(dto.bankAddress) } : {}),
      ...(dto.branchName !== undefined ? { branchName: this.optionalText(dto.branchName) } : {}),
    };
    if (dto.name !== undefined && !data.name) {
      throw new BadRequestException('funding_channel_name_required');
    }
    const willBeActive = dto.active ?? channel.active;
    if (channel.type === ChannelType.VIRTUAL_ACCOUNT && willBeActive) {
      const bankName =
        dto.settlementBankName !== undefined
          ? this.optionalText(dto.settlementBankName)
          : channel.settlementBankName;
      const swiftBic =
        dto.swiftBic !== undefined ? this.optionalText(dto.swiftBic) : channel.swiftBic;
      const bankCountry =
        dto.bankCountry !== undefined ? this.optionalText(dto.bankCountry) : channel.bankCountry;
      const bankAddress =
        dto.bankAddress !== undefined ? this.optionalText(dto.bankAddress) : channel.bankAddress;
      if (!bankName || !swiftBic || !bankCountry || !bankAddress) {
        throw new BadRequestException('virtual_account_channel_bank_details_required');
      }
    }
    return this.db.fundingChannel.update({ where: { id }, data });
  }

  private assertSupportedCurrencies(currencies: Currency[]) {
    if (
      currencies.some(
        (currency) =>
          !supportedFiatCurrencies.includes(currency as (typeof supportedFiatCurrencies)[number])
      )
    ) {
      throw new BadRequestException('unsupported_funding_channel_currency');
    }
  }

  private optionalText(value?: string) {
    const normalized = value?.trim();
    return normalized || null;
  }
}
