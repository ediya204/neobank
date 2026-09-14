import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { CustomersService } from '../dist/src/customers/customers.service.js';

// Run only against a newly migrated, disposable local PostgreSQL database.
const url = process.env.VA_WAIVER_TEST_DATABASE_URL;
test(
  'PostgreSQL waiver rollback, concurrency, settlement and policy audit',
  { skip: !url },
  async () => {
    const target = new URL(url);
    assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
    assert.match(target.pathname, /^\/va_waiver_test(?:_\w+)?$/);
    const db = new PrismaClient({ datasourceUrl: url });
    const service = new CustomersService(db);
    const originalTenant = process.env.NEOBANK_SOURCE_TENANT_ID;
    process.env.NEOBANK_SOURCE_TENANT_ID = 'waiver-test-tenant';
    try {
      await db.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, created_by TEXT NOT NULL, activated_by TEXT)'
      );
      await db.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS customer_auth_audit_events (customer_id TEXT NOT NULL, event_type TEXT NOT NULL, actor TEXT NOT NULL)'
      );
      const org = await db.organization.create({
        data: { name: 'Waiver test', slug: `waiver-${Date.now()}` },
      });
      const admin = await db.user.create({
        data: {
          organizationId: org.id,
          email: `${org.id}@example.test`,
          displayName: 'Test admin',
          role: 'ADMIN',
        },
      });
      const channel = await db.fundingChannel.create({
        data: {
          organizationId: org.id,
          code: 'TEST',
          name: 'Test bank',
          type: 'VIRTUAL_ACCOUNT',
          supportedCurrencies: ['USD'],
          openingFeeUsdMinor: 2500n,
          openingFeeVersion: 1n,
          settlementBankName: 'Test bank',
          swiftBic: 'TESTSGSG',
          bankCountry: 'SG',
          bankAddress: 'Test address',
        },
      });
      if (!(await db.account.findFirst({ where: { kind: 'FEE_REVENUE', currency: 'USD' } }))) {
        await db.account.create({
          data: { kind: 'FEE_REVENUE', status: 'ACTIVE', currency: 'USD', name: 'Test fee income' },
        });
      }
      const actor = { userId: admin.id };
      for (const mode of ['waive', 'approve', 'reject', 'cancel']) {
        const customer = await db.customer.create({
          data: {
            organizationId: org.id,
            creatorId: admin.id,
            type: 'INDIVIDUAL',
            status: 'ACTIVE',
            displayName: mode,
            legalName: mode,
            email: `${mode}-${org.id}@example.test`,
            countryCode: 'SG',
          },
        });
        const wallet = await db.account.create({
          data: {
            customerId: customer.id,
            kind: 'SYSTEM_WALLET',
            status: 'ACTIVE',
            currency: 'USD',
            name: 'Test USD',
            availableBalance: '100',
          },
        });
        const customerActor = { ...actor, customerId: customer.id };
        const request = await service.requestVirtualAccount(
          customer.id,
          {
            channelId: channel.id,
            currency: 'USD',
            purpose: 'Test receipts',
            expectedOpeningFeeUsd: '25.00',
            expectedOpeningFeeVersion: '1',
            expectedFeePolicyVersion: 0,
            idempotencyKey: `request-${customer.id}`,
          },
          customerActor
        );
        await db.account.update({ where: { id: wallet.id }, data: { frozenBalance: 0 } });
        await assert.rejects(
          service.waiveVaOpeningFee(request.id, 'Invalid freeze test', actor),
          /va_opening_fee_reservation_missing/
        );
        assert.equal(
          (await db.virtualAccountRequest.findUniqueOrThrow({ where: { id: request.id } }))
            .openingFeeWaivedAt,
          null
        );
        assert.equal(
          (await db.operation.findUniqueOrThrow({ where: { id: request.feeOperationId } })).status,
          'SUBMITTED'
        );
        await db.account.update({ where: { id: wallet.id }, data: { frozenBalance: 25 } });
        const waive = () => service.waiveVaOpeningFee(request.id, 'Test full waiver', actor);
        const terminal = () =>
          mode === 'approve'
            ? service.approveVirtualAccountRequest(
                request.id,
                { accountName: mode, accountNumber: `VA-${customer.id}` },
                admin.id
              )
            : mode === 'reject'
            ? service.rejectVirtualAccountRequest(request.id, admin.id, 'Test rejection')
            : mode === 'cancel'
            ? service.cancelVirtualAccountRequest(customer.id, request.id, customerActor)
            : waive();
        const results = await Promise.allSettled([waive(), terminal()]);
        assert.ok(
          results.some((r) => r.status === 'fulfilled'),
          results.map((r) => r.reason?.message).join('\n')
        );
        for (const result of results) {
          if (result.status === 'rejected')
            assert.ok(
              result.reason.code === 'P2034' ||
                /request_not_pending|va_fee_concurrent_change/.test(result.reason.message),
              result.reason.message
            );
        }
        let saved = await db.virtualAccountRequest.findUniqueOrThrow({ where: { id: request.id } });
        if (saved.status === 'SUBMITTED') {
          await waive();
          if (mode === 'waive')
            await service.approveVirtualAccountRequest(
              request.id,
              { accountName: mode, accountNumber: `VA-${customer.id}` },
              admin.id
            );
          else await terminal();
        }
        saved = await db.virtualAccountRequest.findUniqueOrThrow({ where: { id: request.id } });
        const balance = await db.account.findUniqueOrThrow({ where: { id: wallet.id } });
        const operation = await db.operation.findUniqueOrThrow({
          where: { id: request.feeOperationId },
        });
        const journals = await db.journalEntry.count({ where: { operationId: operation.id } });
        assert.equal(balance.frozenBalance.toString(), '0');
        assert.equal(saved.openingFeeUsdMinor, 2500n);
        if (saved.openingFeeWaivedAt) {
          assert.equal(balance.availableBalance.toString(), '100');
          assert.equal(operation.status, 'CANCELLED');
          assert.equal(journals, 0);
        } else {
          assert.equal(
            balance.availableBalance.toString(),
            saved.status === 'APPROVED' ? '75' : '100'
          );
          assert.equal(journals, saved.status === 'APPROVED' ? 1 : 0);
        }
        const changes = await Promise.allSettled(
          [true, false].map((enabled) =>
            service.updateVaFeePolicy(
              customer.id,
              'exemption',
              { enabled, expectedVersion: 0, reason: 'Concurrent policy test' },
              actor
            )
          )
        );
        assert.equal(changes.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(await db.vaFeePolicyEvent.count({ where: { customerId: customer.id } }), 1);
        assert.equal(
          (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).vaFeePolicyVersion,
          1
        );
        if (mode === 'waive') {
          const policy = { enabled: true, expectedVersion: 1, reason: 'Confirmed internal staff' };
          await assert.rejects(
            service.updateVaFeePolicy(customer.id, 'identity', policy, actor),
            /admin_created_customer_required/
          );
          await db.$executeRaw`INSERT INTO customers (id, tenant_id, created_by) VALUES (${customer.id}, 'waiver-test-tenant', ${admin.id})`;
          await assert.rejects(
            service.updateVaFeePolicy(customer.id, 'identity', policy, actor),
            /admin_created_customer_required/
          );
          await db.$executeRaw`INSERT INTO customer_auth_audit_events (customer_id, event_type, actor) VALUES (${customer.id}, 'customer.created', ${admin.id})`;
          await service.updateVaFeePolicy(customer.id, 'identity', policy, actor);
          assert.equal(
            (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).isInternal,
            true
          );
          const free = await service.quoteVaOpeningFee(customer.id, channel.id, customerActor);
          assert.equal(free.feeUsd, '0.00');
          const other = await db.operation.create({
            data: {
              customerId: customer.id,
              type: 'PAYOUT',
              status: 'SUBMITTED',
              reference: `non-va-${customer.id}`,
              amount: 10,
              currency: 'USD',
              makerId: admin.id,
            },
          });
          await assert.rejects(
            db.operation.update({ where: { id: other.id }, data: { status: 'CANCELLED' } }),
            /invalid operation transition/
          );
        }
      }
    } finally {
      if (originalTenant === undefined) delete process.env.NEOBANK_SOURCE_TENANT_ID;
      else process.env.NEOBANK_SOURCE_TENANT_ID = originalTenant;
      await db.$disconnect();
    }
  }
);
