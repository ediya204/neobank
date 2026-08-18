import { Global, Module } from '@nestjs/common';
import { EmailDeliveryWorker } from './email-delivery.worker';
import { EmailOutboxService } from './email-outbox.service';
import { ZohoMailClient } from './zoho-mail.client';

@Global()
@Module({
  providers: [EmailOutboxService, ZohoMailClient, EmailDeliveryWorker],
  exports: [EmailOutboxService, ZohoMailClient, EmailDeliveryWorker],
})
export class EmailModule {}
