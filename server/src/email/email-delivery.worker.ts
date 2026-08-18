import { Injectable, Logger } from '@nestjs/common';
import { EmailOutbox, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailDeliveryError, ZohoMailClient } from './zoho-mail.client';

const BATCH_SIZE = 10;
const STALE_LOCK_MS = 10 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

@Injectable()
export class EmailDeliveryWorker {
  private readonly logger = new Logger(EmailDeliveryWorker.name);
  private stopping = false;
  private wake?: () => void;

  constructor(
    private readonly db: PrismaService,
    private readonly zoho: ZohoMailClient
  ) {}

  async run() {
    if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'true') {
      this.logger.warn(
        JSON.stringify({ event: 'email_worker_paused', reason: 'feature_disabled' })
      );
      while (!this.stopping) await this.sleep(60_000);
      return;
    }
    this.zoho.assertConfigured();
    const pollIntervalMs = this.pollIntervalMs();
    this.logger.log(
      JSON.stringify({ event: 'email_worker_started', poll_interval_ms: pollIntervalMs })
    );
    while (!this.stopping) {
      const processed = await this.processBatch();
      if (!processed) await this.sleep(pollIntervalMs);
    }
    this.logger.log(JSON.stringify({ event: 'email_worker_stopped' }));
  }

  stop() {
    this.stopping = true;
    this.wake?.();
  }

  async processBatch() {
    const rows = await this.claimBatch();
    for (const [index, row] of rows.entries()) {
      if (this.stopping) {
        await this.release(rows.slice(index));
        break;
      }
      await this.deliver(row);
    }
    return rows.length;
  }

  private async release(rows: EmailOutbox[]) {
    if (!rows.length) return;
    await this.db.emailOutbox.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, status: 'PROCESSING' },
      data: { status: 'PENDING', lockedAt: null, nextAttemptAt: new Date() },
    });
  }

  private async claimBatch() {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    return this.db.$transaction(async (tx) => {
      await tx.emailOutbox.updateMany({
        where: { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
        data: { status: 'PENDING', lockedAt: null, nextAttemptAt: new Date() },
      });
      const rows = await tx.$queryRaw<EmailOutbox[]>(Prisma.sql`
        SELECT *
        FROM "EmailOutbox"
        WHERE "status" = 'PENDING'::"EmailDeliveryStatus"
          AND "nextAttemptAt" <= NOW()
        ORDER BY "createdAt" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);
      if (!rows.length) return [];
      await tx.emailOutbox.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, status: 'PENDING' },
        data: { status: 'PROCESSING', lockedAt: new Date() },
      });
      return rows;
    });
  }

  private async deliver(row: EmailOutbox) {
    try {
      const result = await this.zoho.send(row);
      await this.db.emailOutbox.updateMany({
        where: { id: row.id, status: 'PROCESSING' },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          lockedAt: null,
          providerMessageId: result.providerMessageId,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      });
      this.logger.log(
        JSON.stringify({
          event: 'email_delivery_sent',
          delivery_id: row.id,
          template: row.templateKey,
        })
      );
    } catch (caught) {
      const error = this.normalizeError(caught);
      const attemptCount = row.attemptCount + 1;
      const dead = !error.retryable || attemptCount >= row.maxAttempts;
      const retryDelay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
      await this.db.emailOutbox.updateMany({
        where: { id: row.id, status: 'PROCESSING' },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          attemptCount,
          nextAttemptAt: dead ? row.nextAttemptAt : new Date(Date.now() + retryDelay),
          lockedAt: null,
          lastErrorCode: error.code,
          lastErrorAt: new Date(),
        },
      });
      this.logger.error(
        JSON.stringify({
          event: 'email_delivery_failed',
          delivery_id: row.id,
          template: row.templateKey,
          attempt: attemptCount,
          retryable: error.retryable,
          dead,
          code: error.code,
        })
      );
    }
  }

  private normalizeError(caught: unknown) {
    if (caught instanceof EmailDeliveryError) return caught;
    if (caught instanceof Error && caught.name === 'TimeoutError') {
      return new EmailDeliveryError('zoho_request_timeout', true);
    }
    return new EmailDeliveryError('zoho_request_failed', true);
  }

  private pollIntervalMs() {
    const parsed = Number(process.env.EMAIL_WORKER_POLL_INTERVAL_MS || 5000);
    return Number.isFinite(parsed) ? Math.min(60_000, Math.max(1000, parsed)) : 5000;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      this.wake = undefined;
    });
  }
}
