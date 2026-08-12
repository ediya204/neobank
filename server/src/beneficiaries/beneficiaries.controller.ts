import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

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
  list(@Query('customerId') customerId: string) {
    return this.db.beneficiary.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  }

  @Post()
  create(@Body() dto: CreateBeneficiaryDto) {
    return this.db.beneficiary.create({ data: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBeneficiaryDto) {
    return this.db.beneficiary.update({ where: { id }, data: dto });
  }
}
