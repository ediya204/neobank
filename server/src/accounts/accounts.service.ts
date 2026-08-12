import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountsService {
  constructor(private readonly db: PrismaService) {}

  list(customerId: string, kind?: AccountKind) {
    return this.db.account.findMany({
      where: { customerId, ...(kind ? { kind } : {}) },
      orderBy: [{ kind: 'asc' }, { currency: 'asc' }],
    });
  }

  async get(id: string) {
    const account = await this.db.account.findUnique({
      where: { id },
      include: { journalLines: { include: { journalEntry: true }, orderBy: { createdAt: 'desc' }, take: 100 } },
    });
    if (!account) throw new NotFoundException('account_not_found');
    return account;
  }
}
