import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import type { Request } from 'express';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { currentUserId } from '../common/current-user';
import { requireActiveUser, requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { supportedFiatCurrencies } from '../supported-assets';

class UpdateChannelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() settlementBankName?: string;
  @IsOptional() @IsString() settlementAccount?: string;
  @IsOptional() @IsString() swiftBic?: string;
}

@Controller('funding-channels')
export class ChannelsController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('type') type?: ChannelType
  ) {
    await requireOrganizationAccess(this.db, currentUserId(request), organizationId);
    const channels = await this.db.fundingChannel.findMany({
      where: { organizationId, ...(type ? { type } : {}) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return channels
      .map((channel) => ({
        ...channel,
        supportedCurrencies: channel.supportedCurrencies.filter((currency) =>
          supportedFiatCurrencies.includes(
            currency as (typeof supportedFiatCurrencies)[number]
          )
        ),
      }))
      .filter((channel) => channel.supportedCurrencies.length > 0);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateChannelDto, @Req() request: Request) {
    const user = await requireActiveUser(this.db, currentUserId(request));
    if (user.role !== 'ADMIN') throw new ForbiddenException('admin_role_required');
    const channel = await this.db.fundingChannel.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!channel || channel.organizationId !== user.organizationId) {
      throw new NotFoundException('funding_channel_not_found');
    }
    return this.db.fundingChannel.update({ where: { id }, data: dto });
  }
}
