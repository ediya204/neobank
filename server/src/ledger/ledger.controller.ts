import { Controller, Get, Query, Req } from '@nestjs/common';
import { Currency } from '@prisma/client';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('customerId') customerId?: string,
    @Query('currency') currency?: Currency
  ) {
    await requireOrganizationAccess(this.db, currentUserId(request), organizationId);
    return this.db.journalEntry.findMany({
      where: {
        operation: {
          customer: { organizationId },
          ...(customerId ? { customerId } : {}),
          ...(currency ? { currency } : {}),
        },
      },
      include: {
        operation: { include: { customer: true } },
        lines: { include: { account: true } },
      },
      orderBy: { postedAt: 'desc' },
      take: 500,
    });
  }
}
