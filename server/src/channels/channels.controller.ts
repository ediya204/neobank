import { Body, Controller, ForbiddenException, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import type { Request } from 'express';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { currentUserId } from '../common/current-user';
import { PrismaService } from '../prisma/prisma.service';

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
  list(@Query('organizationId') organizationId: string, @Query('type') type?: ChannelType) {
    return this.db.fundingChannel.findMany({
      where: { organizationId, ...(type ? { type } : {}) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateChannelDto, @Req() request: Request) {
    const user = await this.db.user.findUnique({ where: { id: currentUserId(request) } });
    if (!user || user.role !== 'ADMIN') throw new ForbiddenException('admin_role_required');
    return this.db.fundingChannel.update({ where: { id }, data: dto });
  }
}
