# VA Opening Fee Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Charge a bank-specific fixed USD fee for customer VA applications, freezing it on submission, posting it to fee revenue on approval, and releasing it on rejection or customer cancellation, with customer, admin, and ledger records.

**Architecture:** Extend the existing `FundingChannel -> VirtualAccountRequest -> Operation -> JournalEntry` path. Keep fee configuration on each VA bank channel, snapshot it on the request, and create one `VA_OPENING_FEE` Operation only for non-zero fees. Perform every state and balance transition in one serializable Render PostgreSQL transaction; reuse existing account and journal models instead of adding another fee ledger.

**Tech Stack:** NestJS, Prisma, Render PostgreSQL, React 18, TypeScript, MUI, Cloudflare Worker route policy, Node test runner, CRA/Jest.

---

## Preconditions

- Work in a dedicated `codex/` branch or worktree created from an up-to-date `origin/main`.
- Re-read `docs/DATASTORE_POLICY.md`, `docs/CODEX_HANDOFF.md`, `docs/DECISIONS.md`, `docs/USER_WORKING_PREFERENCES.md`, `docs/CODEX_CONVERSATION_HANDOFF.md`, `docs/VA_BANK_CHANNELS_RUNBOOK.md`, and `docs/WITHDRAWAL_FEE_RUNBOOK.md`.
- Confirm `git status --short --branch`, `git rev-list --left-right --count HEAD...origin/main`, and current live health before making deployment claims.
- Do not apply a production migration or deploy from this plan. Production database work requires backup, checksum, isolated restore test, manual approval, migration, and post-check.

## Task 1: Add the PostgreSQL schema and immutable fee links

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260903000000_va_opening_fee/migration.sql`
- Modify: `server/test/virtual-account-channels.test.mjs`

### Step 1: Add a failing schema contract test

Add a test that reads `server/prisma/schema.prisma` and asserts the minimum contract:

```js
test('VA opening fee schema keeps one request snapshot and one optional operation', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.match(schema, /VA_OPENING_FEE/);
  assert.match(schema, /CANCELLED/);
  assert.match(schema, /openingFeeUsdMinor\s+BigInt\?/);
  assert.match(schema, /feeOperationId\s+String\?\s+@unique/);
  assert.match(schema, /@@unique\(\[customerId, idempotencyKey\]\)/);
});
```

Run:

```bash
npm run api:build
node --test --test-concurrency=1 server/test/virtual-account-channels.test.mjs
```

Expected: the new schema contract test fails.

### Step 2: Extend the Prisma models

Add:

```prisma
enum AccountRequestStatus {
  SUBMITTED
  APPROVED
  REJECTED
  CANCELLED
}

enum OperationType {
  // existing values
  VA_OPENING_FEE
}
```

Add to `FundingChannel`:

```prisma
openingFeeUsdMinor  BigInt?
openingFeeVersion   BigInt   @default(0)
openingFeeUpdatedBy String?
openingFeeUpdatedAt DateTime? @db.Timestamptz(6)
```

Add to `VirtualAccountRequest`:

```prisma
idempotencyKey      String?
openingFeeUsdMinor  BigInt   @default(0)
openingFeeVersion   BigInt   @default(0)
feeOperationId      String?  @unique
feeOperation        Operation? @relation("VaOpeningFeeOperation", fields: [feeOperationId], references: [id])

@@unique([customerId, idempotencyKey])
```

Add the inverse optional relation to `Operation`:

```prisma
vaOpeningFeeRequest VirtualAccountRequest? @relation("VaOpeningFeeOperation")
```

### Step 3: Add the PostgreSQL migration

The migration must:

- add `CANCELLED` to `AccountRequestStatus` and `VA_OPENING_FEE` to `OperationType`;
- add the four channel configuration columns;
- add the four request snapshot/link columns;
- add `CHECK ("openingFeeUsdMinor" >= 0)` where applicable;
- add unique indexes for `(customerId, idempotencyKey)` and `feeOperationId`;
- add the request-to-operation foreign key with `ON DELETE SET NULL`;
- preserve existing requests as zero-fee historical rows;
- leave existing active channels active but with `openingFeeUsdMinor = NULL`, so new submissions are blocked until an administrator explicitly configures a value.

Do not seed a guessed production fee.

### Step 4: Generate and verify

Run:

```bash
npm run api:prisma:generate
npm run api:build
node --test --test-concurrency=1 server/test/virtual-account-channels.test.mjs
git diff --check
```

Expected: build and schema contract pass.

### Step 5: Commit

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260903000000_va_opening_fee/migration.sql server/test/virtual-account-channels.test.mjs
git commit -m "feat: add VA opening fee schema"
```

## Task 2: Configure a fee on each VA bank channel

**Files:**

- Modify: `server/src/channels/channels.controller.ts`
- Modify: `server/test/funding-channels.test.mjs`
- Modify: `src/features/finance/core-api.ts`

### Step 1: Write failing controller tests

Cover these cases in `server/test/funding-channels.test.mjs`:

- a VA channel accepts `openingFeeUsd: "25.00"` and stores `2500n`;
- a free channel accepts `"0.00"`;
- negative amounts or more than two decimal places fail;
- non-VA channels reject the field;
- activating a VA channel with `null` fee fails with `virtual_account_opening_fee_not_configured`;
- changing the fee requires the current version and increments it;
- a stale version returns `virtual_account_opening_fee_changed`;
- customer channel reads expose only formatted amount and version, not updater identity.

Run:

```bash
npm run api:build
node --test --test-concurrency=1 server/test/funding-channels.test.mjs
```

Expected: new tests fail.

### Step 2: Extend the existing channel DTOs and serializer

Add optional `openingFeeUsd` to the create and update DTOs, plus `expectedOpeningFeeVersion` to the update DTO. A newly created VA channel may save its first explicit fee while remaining inactive. Reuse Prisma Decimal for exact conversion:

```ts
function toUsdMinor(value: string) {
  const amount = new Prisma.Decimal(value);
  if (amount.isNegative() || amount.decimalPlaces() > 2) throw invalidFee();
  return BigInt(amount.mul(100).toFixed(0));
}

function fromUsdMinor(value: bigint | null) {
  return value === null ? null : new Prisma.Decimal(value.toString()).div(100).toFixed(2);
}
```

Keep these helpers local unless another completed task needs the exact same conversion. Do not introduce a general pricing abstraction.

When `openingFeeUsd` is present:

- require a `VIRTUAL_ACCOUNT` channel;
- parse `expectedOpeningFeeVersion` as `BigInt`;
- update with `updateMany({ where: { id, openingFeeVersion: expectedVersion } })`;
- set amount, updater, timestamp, and increment version;
- return a conflict when `count !== 1`.

When returning channels, serialize BigInt fields to strings. Customer responses include `openingFeeUsd` and `openingFeeVersion`, but exclude `openingFeeUpdatedBy`.

### Step 3: Update frontend types

Extend `FundingChannel` with:

```ts
openingFeeUsd?: string | null;
openingFeeVersion: string;
openingFeeUpdatedBy?: string;
openingFeeUpdatedAt?: string;
```

### Step 4: Verify and commit

Run:

```bash
npm run api:build
node --test --test-concurrency=1 server/test/funding-channels.test.mjs
npm run typecheck
git diff --check
```

Commit:

```bash
git add server/src/channels/channels.controller.ts server/test/funding-channels.test.mjs src/features/finance/core-api.ts
git commit -m "feat: configure VA opening fees by bank"
```

## Task 3: Freeze the USD fee when a customer submits

**Files:**

- Modify: `server/src/customers/customers.controller.ts`
- Modify: `server/src/customers/customers.service.ts`
- Modify: `server/src/operations/operations.service.ts`
- Modify: `server/test/virtual-account-channels.test.mjs`
- Modify: `server/test/operation-policy.test.mjs`

### Step 1: Write failing submission tests

Add focused tests for:

- non-zero fee: one serializable transaction creates the request and `VA_OPENING_FEE` Operation and moves fee from available to frozen;
- zero fee: creates only the request snapshot and does not touch balances or operations;
- HKD VA request still freezes the USD wallet;
- missing fee configuration, missing active USD wallet, and insufficient available balance fail without creating a request;
- stale expected amount/version fails with `virtual_account_opening_fee_changed`;
- same `(customerId, idempotencyKey)` returns the existing request before resolving the current fee or freezing again;
- concurrent duplicate bank/currency submissions leave only one frozen reservation.
- generic Operation create/approve/reject/execute paths reject `VA_OPENING_FEE`, because only the VA request service owns this lifecycle;
- the generic approvals queue excludes `VA_OPENING_FEE`, while ordinary Operation list queries still return it for audit/history.

The core assertion for a 25 USD fee should be:

```js
assert.deepEqual(balanceUpdate.data, {
  availableBalance: { decrement: new Prisma.Decimal('25.00') },
  frozenBalance: { increment: new Prisma.Decimal('25.00') },
  version: { increment: 1 },
});
assert.equal(operationData.type, 'VA_OPENING_FEE');
assert.equal(operationData.status, 'SUBMITTED');
assert.equal(operationData.amount.toFixed(2), '25.00');
```

Run the targeted test and confirm failure.

### Step 2: Accept the confirmation and idempotency inputs

Extend `CreateVaRequestDto` with numeric-string `expectedOpeningFeeUsd` and string `expectedOpeningFeeVersion`. Read and validate the `Idempotency-Key` request header; require a bounded non-empty value for customer-originated requests and pass it to the service.

Do not accept `sourceAccountId`, `targetAccountId`, `feeAmount`, or a client-authored fee snapshot.

### Step 3: Move submission into one serializable transaction

Inside `requestVirtualAccount`:

1. validate customer ownership and active status;
2. return the existing request for the same idempotency key;
3. load the active VA channel in the same transaction;
4. reject `openingFeeUsdMinor === null`;
5. compare expected amount and version;
6. for a non-zero fee, load exactly one active customer `SYSTEM_WALLET / USD` and the active `FEE_REVENUE / USD` account;
7. conditionally decrement available and increment frozen using `updateMany` with `availableBalance >= fee`;
8. create the `VA_OPENING_FEE` Operation with immutable metadata;
9. create the VA request with fee snapshot and operation link.

Use one generated fee reference derived from the request identity and prefix the Operation idempotency key with `va-opening-fee:`; rely on the existing unique Operation reference and request constraints for retry safety. Include `feeOperation.sourceAccount` and `feeOperation.targetAccount` in request reads needed by the customer/admin audit views.

Return every VA request through one JSON-safe serializer: expose `openingFeeUsd` and string `openingFeeVersion`, omit raw BigInt values, and apply the same conversion to the nested channel. Use it for create, customer list, admin list, approve, reject, and cancel responses so no route attempts to serialize a BigInt.

Add an explicit `VA_OPENING_FEE` guard to generic Operation creation and mutations, and exclude it from the generic approval queue. Do not route it through `postApprovedOperation`; approval/rejection/cancellation must remain coupled to the VA request transaction.

### Step 4: Verify and commit

Run:

```bash
npm run api:build
node --test --test-concurrency=1 server/test/virtual-account-channels.test.mjs
node --test --test-concurrency=1 server/test/operation-policy.test.mjs
npm run api:test
git diff --check
```

Commit:

```bash
git add server/src/customers/customers.controller.ts server/src/customers/customers.service.ts server/src/operations/operations.service.ts server/test/virtual-account-channels.test.mjs server/test/operation-policy.test.mjs
git commit -m "feat: reserve VA opening fee on submission"
```

## Task 4: Post, reject, or cancel the fee atomically

**Files:**

- Modify: `server/src/customers/customers.controller.ts`
- Modify: `server/src/customers/virtual-accounts.controller.ts`
- Modify: `server/src/customers/customers.service.ts`
- Modify: `server/test/virtual-account-channels.test.mjs`

### Step 1: Write failing transition tests

Add tests proving:

- approval consumes the frozen USD fee, creates the VA account, creates exactly one balanced journal, and marks request/operation terminal;
- the journal debits the customer USD wallet and credits `FEE_REVENUE / USD` without `PLATFORM_CLEARING`;
- rejection releases the frozen fee and marks the operation `REJECTED` without a journal;
- customer cancellation releases the fee and marks request/operation `CANCELLED` without a journal;
- zero-fee approval/rejection/cancellation do not query or mutate an Operation;
- duplicate or racing terminal actions return `request_not_pending` and cannot consume/release twice;
- a customer cannot cancel another customer's or another organization's request.

Run the targeted test and confirm failure.

### Step 2: Add the customer cancellation API

Add:

```text
PATCH /api/v1/customers/:customerId/virtual-account-requests/:requestId/cancel
```

The controller passes the authenticated customer actor. The service verifies both path customer ID and request ownership and permits only `requestSource = CUSTOMER` and `status = SUBMITTED`.

### Step 3: Implement the three terminal transitions

Keep small private balance helpers in `CustomersService`, mirroring the conditional update semantics already used in `OperationsService`:

```ts
await tx.account.updateMany({
  where: { id: sourceId, frozenBalance: { gte: fee } },
  data: { frozenBalance: { decrement: fee }, version: { increment: 1 } },
});
```

Approval for a non-zero fee must also create one journal entry whose reference is `${operation.reference}-principal` and whose two lines use the same USD amount. Update the Operation to `COMPLETED` with checker/operator and `executedAt` only after all financial writes are ready inside the same transaction.

Before posting, verify the linked target remains the active `FEE_REVENUE / USD` system account. A missing, disabled, wrong-kind, or wrong-currency target blocks approval and leaves the whole transaction unchanged.

Rejection and cancellation unfreeze the amount and set the corresponding terminal Operation status and reason. Do not create reversal journals because no formal journal exists before approval.

### Step 4: Verify and commit

Run:

```bash
npm run api:build
node --test --test-concurrency=1 server/test/virtual-account-channels.test.mjs
npm run api:test
git diff --check
```

Commit:

```bash
git add server/src/customers/customers.controller.ts server/src/customers/virtual-accounts.controller.ts server/src/customers/customers.service.ts server/test/virtual-account-channels.test.mjs
git commit -m "feat: settle and release VA opening fees"
```

## Task 5: Expose only safe customer routes and records

**Files:**

- Modify: `worker-web/customer-core-route-policy.ts`
- Modify: `worker-web/customer-core-route-policy.test.ts`
- Modify: `src/features/finance/core-api.ts`

### Step 1: Write failing route-policy tests

Prove that a customer may PATCH only:

```text
/api/core/customers/<own-id>/virtual-account-requests/<request-id>/cancel
```

Reject a different customer ID, extra path segments, query parameters, GET/POST, and all admin approve/reject paths.

Run:

```bash
node --experimental-strip-types --test worker-web/customer-core-route-policy.test.ts
```

Expected: new allow case fails.

### Step 2: Add the narrow route rule

Parse the path with one anchored regular expression and compare the captured customer ID with the session customer ID. Do not interpolate an unescaped customer ID into a regular expression. Keep CSRF and existing signed upstream proxy behavior unchanged.

### Step 3: Extend response types

Add the request snapshot and fee link to `VirtualAccountRequest`:

```ts
status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
openingFeeUsd: string;
openingFeeVersion: string;
feeOperationId?: string;
feeOperation?: Operation;
```

Add `VA_OPENING_FEE` to `OperationType` and a typed `metadata` subset sufficient for bank/request display. The customer response must continue to redact maker/checker/operator and platform-account internals.

### Step 4: Verify and commit

Run:

```bash
node --experimental-strip-types --test worker-web/customer-core-route-policy.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add worker-web/customer-core-route-policy.ts worker-web/customer-core-route-policy.test.ts src/features/finance/core-api.ts
git commit -m "feat: expose customer VA fee lifecycle safely"
```

## Task 6: Add the admin fee configuration and audit display

**Files:**

- Modify: `src/pages/dashboard/finance-workspace.tsx`
- Modify: `src/pages/dashboard/va-request-review.tsx`
- Modify: `src/pages/dashboard/core-overview.tsx`
- Modify: `src/pages/dashboard/core-reconciliation.tsx`

### Step 1: Extend the existing channel editor

For `VIRTUAL_ACCOUNT` only, add one USD amount field to the current editor. Show:

- `开户手续费（USD）`;
- current version;
- last updated time;
- “0.00 表示免费；未配置的渠道不能接受新申请”.

Submit `openingFeeUsd` and `expectedOpeningFeeVersion` through the existing channel PATCH. Do not add a new menu, modal framework, fee table, or client-specific rule UI.

### Step 2: Add the VA review audit panel

Show the request fee snapshot, source USD wallet, fee Operation reference/status, and the lifecycle meaning. For approved requests link the record conceptually to the existing transaction and ledger views; do not invent another fee history screen.

Replace the stale copy:

```text
VA 账户初始余额为 0；如配置开户费，批准时将扣除已冻结的 USD 手续费并产生账本分录。
```

When rejecting, state that the frozen fee will be released. When a request is already `CANCELLED`, render it read-only.

Add the `VA_OPENING_FEE` label to the existing exhaustive Operation label maps in the Admin overview, reconciliation page, and finance workspace. Do not offer this server-owned type in the generic create-operation form.

### Step 3: Verify and commit

Run:

```bash
npm run typecheck
npm run i18n:check
npm run build
git diff --check
```

Commit:

```bash
git add src/pages/dashboard/finance-workspace.tsx src/pages/dashboard/va-request-review.tsx src/pages/dashboard/core-overview.tsx src/pages/dashboard/core-reconciliation.tsx
git commit -m "feat: manage and review VA opening fees"
```

## Task 7: Show fee confirmation, cancellation, and customer activity

**Files:**

- Modify: `src/pages/portal/customer-accounts.tsx`
- Modify: `src/pages/portal/virtual-accounts.tsx`
- Modify: `src/pages/portal/customer-activity.tsx`
- Modify: `src/pages/portal/customer-home.tsx`
- Modify: `src/pages/portal/customer-shared.tsx`
- Modify: `src/features/finance/core-api.ts`
- Modify: `src/features/finance/core-api-errors.test.ts`
- Modify: `src/locales/langs/portal.cn.json`
- Modify: `src/locales/langs/portal.en.json`

### Step 1: Update the application form

In both existing VA application entry points, show the selected channel's fixed fee and the customer's active USD wallet balance. The confirmation block must include:

```text
开户手续费       USD 25.00
扣款钱包         SSC 钱包 · USD
当前可用余额     USD 100.00
提交后可用余额   USD 75.00
```

Disable submission when the fee is missing, the USD wallet is missing, or available balance is insufficient. Submit the displayed amount/version and a generated `Idempotency-Key`; retain the same key while a request is in flight so a retry cannot freeze twice.

Use existing MUI components, spacing, colors, and `portalText`; do not redesign the modal or add an image asset.

### Step 2: Add customer cancellation and request status

For an owned `SUBMITTED` request, add a confirmation action explaining the release. After success, reload accounts, requests, and activity. Add `CANCELLED` presentation and show:

- submitted: `手续费已冻结`;
- approved: `手续费已扣除`;
- rejected/cancelled: `手续费已释放`;
- zero fee: `免费`.

### Step 3: Add the fee Operation to transaction details

Map `VA_OPENING_FEE` to “VA 开户手续费”, fiat outflow, and the existing operation detail drawer. Read bank, application request ID, rule version, and timestamps from the typed metadata. Use Operation status to display frozen/deducted/released; never expose internal actor IDs.

Update the existing customer-home and shared Operation label maps. Count completed VA opening fees as USD outflow in the home-page movement summary; submitted fees remain a frozen balance, not a completed outflow.

### Step 4: Add Chinese and English strings

Add every new `portalText` key to both locale files and map the new Core business error codes in `core-api.ts`. Extend `core-api-errors.test.ts` for changed fee, missing fee, missing USD wallet, and insufficient balance. Keep the Chinese key set identical across locales.

### Step 5: Verify and commit

Run:

```bash
npm run typecheck
npm run i18n:check
npm exec react-scripts test -- --watchAll=false --runTestsByPath src/features/finance/core-api-errors.test.ts
npm run build
git diff --check
```

Commit:

```bash
git add src/pages/portal/customer-accounts.tsx src/pages/portal/virtual-accounts.tsx src/pages/portal/customer-activity.tsx src/pages/portal/customer-home.tsx src/pages/portal/customer-shared.tsx src/features/finance/core-api.ts src/features/finance/core-api-errors.test.ts src/locales/langs/portal.cn.json src/locales/langs/portal.en.json
git commit -m "feat: show VA opening fee lifecycle to customers"
```

## Task 8: Add reconciliation assertions and operating documentation

**Files:**

- Modify: `src/features/finance/core-reconciliation.ts`
- Modify: `src/features/finance/core-reconciliation.test.ts`
- Modify: `src/pages/dashboard/finance-workspace.tsx`
- Modify: `docs/VA_BANK_CHANNELS_RUNBOOK.md`
- Modify: `docs/DECISIONS.md`

### Step 1: Write failing reconciliation tests

Add fixtures for:

- completed non-zero VA fee with one balanced journal;
- completed non-zero VA fee without a journal;
- rejected/cancelled fee with an unexpected journal;
- duplicate journals for one VA fee Operation;
- completed-fee total matching USD `FEE_REVENUE` credit lines.
- submitted request fees grouped by source wallet whose frozen balance does not cover the group total.

The snapshot should expose a concise issue collection, not a new reconciliation subsystem.

Run:

```bash
npm exec react-scripts test -- --watchAll=false --runTestsByPath src/features/finance/core-reconciliation.test.ts
```

Expected: new assertions fail.

### Step 2: Extend the current reconciliation snapshot

Load the existing admin VA-request endpoint with each linked fee Operation and source wallet, then group submitted fee amounts by source wallet. Report undercoverage when `frozenBalance` is less than the sum of active VA fee reservations for that wallet. Count journals per `VA_OPENING_FEE` Operation and compare completed amount totals with USD fee-revenue credit lines. Keep the existing balanced-journal and completed-without-journal checks; other reservations may make frozen balance larger, so do not require exact equality.

### Step 3: Update runbooks and decision record

Update the VA state diagram and replace the old “no ledger entry” rule. Document:

- channel fee configuration and null-vs-zero semantics;
- submit/freeze, approve/post, reject/cancel/release;
- Operation and journal references;
- tenant isolation and customer cancellation route;
- backup/restore/manual approval/post-check requirements;
- no real bank or wallet transfer.

Record the decision to reuse `Operation` and `JournalEntry` instead of adding a fee-log table.

### Step 4: Verify and commit

Run:

```bash
npm exec react-scripts test -- --watchAll=false --runTestsByPath src/features/finance/core-reconciliation.test.ts
npm run i18n:check
git diff --check
```

Commit:

```bash
git add src/features/finance/core-reconciliation.ts src/features/finance/core-reconciliation.test.ts src/pages/dashboard/finance-workspace.tsx docs/VA_BANK_CHANNELS_RUNBOOK.md docs/DECISIONS.md
git commit -m "docs: define VA fee reconciliation and operations"
```

## Task 9: Replace native VA cancellation prompts

**Files:**

- Modify: `src/pages/portal/virtual-accounts.tsx`
- Test: `scripts/check-neobank-isolated-profile.mjs`

### Step 1: Add the failing UI-policy assertions

Assert that the customer VA page contains no `window.alert` or `window.confirm`, and that it renders a MUI `Dialog` for a selected pending request with the exact USD fee-release copy.

Run:

```bash
npm run neobank:profile:check
```

Expected: fail while `window.confirm` remains.

### Step 2: Implement the minimal confirmation dialog

Store only the selected request in component state. The existing “取消申请” action opens a MUI `Dialog`; its body names the bank and exact frozen USD opening fee. The secondary action closes it. The destructive confirmation reuses the existing cancellation API call, disables both actions while submitting, closes on success, and leaves the dialog open with the existing page-level error on failure.

Do not use native `alert` or `confirm`. Keep page-level MUI `Alert` for status feedback.

### Step 3: Verify and commit

Run:

```bash
npm run neobank:profile:check
npm run typecheck
npm run i18n:check
npm exec react-scripts test -- --watchAll=false --runTestsByPath src/features/finance/core-api-errors.test.ts
git diff --check
```

Commit:

```bash
git add src/pages/portal/virtual-accounts.tsx scripts/check-neobank-isolated-profile.mjs src/locales/langs/portal.cn.json src/locales/langs/portal.en.json docs/plans/2026-09-03-va-opening-fee-implementation.md
git commit -m "fix: replace native VA cancellation prompt"
```

## Task 10: Full local verification and release evidence

**Files:**

- Modify only if verification finds an in-scope defect.

### Step 1: Run the complete required checks

```bash
npm run typecheck
npm run i18n:check
npm run api:test
npm run api:build
npm run build
npm run neobank:deploy:dry-run
git diff --check
git status --short --branch
```

Expected: all checks pass; deployment dry-run does not publish.

### Step 2: Run focused money-flow acceptance

Using isolated local PostgreSQL test data only, verify:

1. Bank A and Bank B return different configured USD fees.
2. Submission decreases USD available and increases USD frozen by the exact fee once.
3. Approval decreases frozen, creates one VA account, one completed fee Operation, and one balanced journal.
4. Rejection and customer cancellation restore available and create no journal.
5. A stale quote and insufficient balance fail without partial writes.
6. Same idempotency key returns the original request.
7. Customer A cannot read or cancel Customer B's request.
8. Admin transaction and ledger views point to the same fee Operation.

Do not execute a real bank or wallet transfer.

### Step 3: Review the diff for secrets and scope

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
```

Confirm no `.dev.vars`, `.wrangler`, `.local-auth`, exports, backups, production data, credentials, or build output are tracked.

### Step 4: Final commit only if verification required fixes

```bash
git add <only-the-verified-fix-files>
git commit -m "test: verify VA opening fee flow"
```

## Production rollout gate (manual, separately authorized)

Do not execute these steps without explicit user approval:

1. Take a complete Render PostgreSQL backup and record its checksum.
2. Restore the backup into an isolated PostgreSQL 17 instance and verify schema plus row counts.
3. Pause new VA application writes.
4. Have an operator manually approve the migration checksum and channel fee values.
5. Apply the Prisma migration and post-check enum values, constraints, indexes, and existing row defaults.
6. Explicitly configure every active VA bank to either its approved USD fee or `0.00`.
7. Publish Core API, then verify unauthorized and cross-tenant requests fail.
8. Publish Web separately, then verify the customer and Admin UI with isolated test customers.
9. Reconcile request, Operation, wallet freeze, journal, and fee-revenue credit totals.
10. Resume VA submissions only after the auditable post-check passes.

GitHub publication, Render migration/Core publication, and Cloudflare Web publication remain separate approvals.
