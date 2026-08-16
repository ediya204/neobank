import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { syncNeobankCustomers } from '../src/customers/neobank-customer-sync';

const db = new PrismaClient();

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const organizationId = process.env.CORE_ORGANIZATION_ID?.trim() || 'org_neobank';
  const adminUserId = process.env.CORE_ADMIN_USER_ID?.trim() || 'usr_neobank_admin';
  const adminEmail = required('CORE_ADMIN_EMAIL').toLowerCase();
  const tenantId = process.env.TENANT_ID?.trim() || 'neobank';

  await db.organization.upsert({
    where: { id: organizationId },
    update: { name: 'SCC Digital Bank', slug: 'scc-digital-bank' },
    create: { id: organizationId, name: 'SCC Digital Bank', slug: 'scc-digital-bank' },
  });
  await db.user.upsert({
    where: { id: adminUserId },
    update: {
      active: true,
      displayName: 'Neobank Administrator',
      email: adminEmail,
      organizationId,
      role: 'ADMIN',
    },
    create: {
      id: adminUserId,
      active: true,
      displayName: 'Neobank Administrator',
      email: adminEmail,
      organizationId,
      role: 'ADMIN',
    },
  });

  const importedCustomers = await syncNeobankCustomers(db, {
    adminUserId,
    organizationId,
    tenantId,
  });

  console.log(
    JSON.stringify({
      importedCustomers,
      organizationId,
      adminUserId,
    })
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
