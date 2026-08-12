import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { VirtualAccountsController } from './virtual-accounts.controller';

@Module({ controllers: [CustomersController, VirtualAccountsController], providers: [CustomersService] })
export class CustomersModule {}
