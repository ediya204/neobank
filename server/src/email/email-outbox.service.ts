import { Injectable } from '@nestjs/common';
import { EmailTemplateKey, Prisma } from '@prisma/client';

export type EnqueueEmailInput = {
  organizationId: string;
  customerId: string;
  dedupeKey: string;
  templateKey: EmailTemplateKey;
  recipient: string;
  payload: Prisma.InputJsonValue;
};

@Injectable()
export class EmailOutboxService {
  enabled() {
    return process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true';
  }

  async enqueue(tx: Prisma.TransactionClient, input: EnqueueEmailInput) {
    if (!this.enabled()) return null;
    return tx.emailOutbox.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        dedupeKey: input.dedupeKey,
        templateKey: input.templateKey,
        recipient: input.recipient.trim().toLowerCase(),
        payload: input.payload,
      },
    });
  }
}
