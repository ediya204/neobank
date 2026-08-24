# Cregis deposit accounting runbook

## Authority and state order

The supported order is:

```text
Cregis signed callback
  -> exact trade verification (CID, TxID, asset, amount, destination, source)
  -> PostgreSQL custody row + durable accounting intent
  -> authenticated synchronous Core serializable posting transaction
       -> completed Operation
       -> completed CryptoTransfer
       -> balanced JournalEntry / JournalLines
       -> Account and CryptoWallet materialized balances
  -> intent posted in the same Core transaction
  -> customer and Admin show completed / available
```

Cregis is authoritative for the external custody event. The Core double-entry
journal is authoritative for customer money. React pages, the Go API, and Admin
overview are readers; none may create, infer, or repair a balance.

The public states are deliberately conservative:

| Custody   | Accounting              | Customer/Admin state | Available balance |
| --------- | ----------------------- | -------------------- | ----------------- |
| failed    | absent                  | failed               | no                |
| completed | held/pending/processing | processing           | no                |
| completed | exception               | exception            | no                |
| completed | posted                  | completed            | yes               |

Callback delivery is at least once. The accounting effect is exactly once through
the unique Cregis CID, completed TxID, Core operation reference, customer
idempotency key, and one serializable database transaction. A lost HTTP response
before commit is retryable. A lost response after commit sees the intent already
posted, so it cannot create a second financial effect. The former polling worker
remains paused only as a staged rollback shell until the direct path and historical
queue state have been verified.

Callback transport and accounting completion are deliberately distinct:

- invalid signatures are rejected and no payload field is trusted;
- a transient database or Core failure does not return `success`, allowing Cregis
  replay;
- a posted or idempotently duplicate event returns literal `success`;
- permanently conflicting evidence is durably retained for manual review, moves no
  balance, and returns `success` because replaying the same evidence cannot repair it.

## Release order

Do not combine these into one unreviewed release:

1. Make a complete Render PostgreSQL backup, record SHA-256, restore it into an
   isolated PostgreSQL 17 database, and verify row counts and financial invariants.
2. Review the exact checksum of
   `migrations-postgres/0010_cregis_deposit_accounting.sql`, obtain manual approval,
   and apply it with `cmd/postgres-migrate`.
3. Verify that the migration created an empty accounting queue. It intentionally
   does not enqueue historical deposits.
4. Deploy Core and Go from the same reviewed commit with
   `CREGIS_DIRECT_ACCOUNTING_ENABLED=false`. Configure the dedicated internal URL
   and secret without exposing either value. Keep
   `FINANCIAL_ACCOUNTING_PROCESSING_ENABLED=false` on the old worker.
5. Verify accounting tables, historical queue counts, system accounts, tenant scope,
   and all balance/journal invariants through read-only PostgreSQL checks. Enable the
   direct flag only after an approved no-payout test proves the authenticated path.
6. Deploy the web Worker only if its source changed. GitHub publication,
   PostgreSQL migration, each Render service deployment, and Cloudflare deployment
   remain separate evidence items.
7. Run one explicitly approved small-deposit UAT. A callback HTTP success is not
   acceptance; assert the custody row, posted intent, one Operation, one balanced
   journal, both equal materialized USDT balances, customer history, and Admin
   overview.
8. Remove the old Render accounting worker only after no new flow depends on it and
   every historical queue row has an evidenced disposition. Retain the accounting
   tables for audit until a separately approved archival plan exists.

Never enable a real payout as part of deposit acceptance.

## Historical deposit reconciliation

Historical deposits are never automatically credited. Build Core first, then use
the read-only preview:

```bash
npm --prefix server run build
npm --prefix server run deposit:reconcile -- preview
npm --prefix server run deposit:reconcile -- preview --deposit-id DEPOSIT_ID
```

For one exact reviewed deposit, the first mutation creates a non-postable `held`
record. Both `hold` and `release` require the production backup checksum, confirmed
restore test, named approver, and reason in environment variables. `release` also
requires the separate release approval gate. Do not paste those values into chat,
source, shell history, or tickets.

```bash
npm --prefix server run deposit:reconcile -- hold --deposit-id DEPOSIT_ID
npm --prefix server run deposit:reconcile -- release --deposit-id DEPOSIT_ID
```

After `hold`, inspect the exact customer, tenant, Cregis CID, TxID, source and
destination, amount, wallet ownership, and absence of any existing Core reference.
Only then approve `release`. Releasing changes the row to `pending`; the command
does not perform the financial transaction. Before the old worker can be retired,
each approved historical row must receive a separately approved Core accounting
execution and pass the same post-checks as a new direct callback.

The Admin reconciliation page is a read-only triage surface. A completed deposit
with `accounting_status=missing` is marked as a critical manual-reconciliation
candidate, but the page never creates the intent or changes money. Operators must
still run the exact single-record preview and complete every backup, restore,
approval, `hold`, evidence-review, and `release` gate above.

## Acceptance invariants

For each posted deposit:

- one `cregis_deposits` row and one `cregis_deposit_accounting` row exist;
- the accounting row is `posted` and links one completed Core Operation;
- one completed Core CryptoTransfer has the same customer, amount, TxID, network,
  source, and destination;
- the principal journal has one USDT debit to platform clearing and one equal USDT
  credit to the customer's crypto account;
- no duplicate Core reference, customer idempotency key, or completed Cregis TxID
  exists;
- the Account and CryptoWallet increments equal the journal credit and were committed
  with it;
- customer and Admin histories agree on processing/completed/exception state;
- no cross-tenant row, inactive customer, unverified wallet, or wallet-address
  mismatch can post.

If any invariant fails, leave the item in `exception`. Never edit a balance, delete
a journal, reuse a TxID, rebind a wallet, or mark it posted manually. A correction
requires a separately approved compensating accounting transaction.
