import { Module } from '@nestjs/common';
import { BeneficiariesController } from './beneficiaries.controller';

@Module({ controllers: [BeneficiariesController] })
export class BeneficiariesModule {}
