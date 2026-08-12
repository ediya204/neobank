import { Controller, Get, Query } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @Query('customerId') customerId?: string,
    @Query('currency') currency?: Currency
  ) {
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
