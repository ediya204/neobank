import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TenantDatabase = PrismaService | Prisma.TransactionClient;

export async function requireActiveUser(db: TenantDatabase, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, active: true, organizationId: true, role: true },
  });
  if (!user?.active || !user.organizationId || user.role !== 'ADMIN') {
    throw new ForbiddenException('admin_role_required');
  }
  return user;
}

export async function requireOrganizationAccess(
  db: TenantDatabase,
  userId: string,
  organizationId: string
) {
  const user = await requireActiveUser(db, userId);
  if (!organizationId || user.organizationId !== organizationId) {
    throw new ForbiddenException('cross_tenant_organization');
  }
  return user;
}

export async function requireCustomerAccess(
  db: TenantDatabase,
  userId: string,
  customerId: string
) {
  const user = await requireActiveUser(db, userId);
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, organizationId: true, status: true },
  });
  if (!customer || customer.organizationId !== user.organizationId) {
    throw new NotFoundException('customer_not_found');
  }
  return { user, customer };
}
