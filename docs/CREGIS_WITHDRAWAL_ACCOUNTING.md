# Cregis withdrawal accounting runbook

## Authority and state order

The Core journal is the only customer-money authority. Cregis records custody
submission and final chain evidence; neither a Go status nor a callback may edit a
customer balance directly.

```text
customer request
  -> PostgreSQL custody row + accounting intent
  -> Core serializable reservation (Account + CryptoWallet frozen together)
  -> Admin approval recorded in custody
  -> Core Operation + CryptoTransfer move to PROCESSING
  -> Cregis submission
  -> signed final callback
       completed -> Core consumes frozen funds and posts principal + fee journals
       failed/rejected/cancelled -> Core releases both frozen balances
  -> customer and Admin read the Core result
```

`WITHDRAWAL_ACCOUNTING_ENABLED` defaults to `false`. Enabling it without migration
`0011_cregis_withdrawal_accounting` is a startup error. A request cannot be approved
until its accounting intent is `reserved`; it cannot be executed until the Core
approval hand-off is `approved`. A final callback only queues settlement or release.

## Release order

These are separate, manually approved changes:

1. Disable customer withdrawal creation and manual OTC writes.
2. Take a complete Render PostgreSQL backup, record its SHA-256, restore it to an
   isolated PostgreSQL 17 instance, and verify financial row counts and balances.
3. Review and apply migrations `0010` and `0011` in order. Confirm both new queues
   contain no historical rows.
4. Deploy `neobank-financial-accounting-worker` with withdrawal accounting still
   disabled in the Go service. Verify worker startup, empty queues, and Core USDT
   clearing and fee accounts.
5. Deploy Core and Go code with `WITHDRAWAL_ACCOUNTING_ENABLED=false`. Verify the
   customer endpoint remains closed and the USDT reconciliation endpoint is green.
6. Reconcile historical deposits and withdrawals one item at a time under a separate
   approval. Never infer customer money from aggregate custody history.
7. Set `WITHDRAWAL_ACCOUNTING_ENABLED=true` only after an explicitly approved,
   no-payout reservation/rejection UAT proves freeze and release in both materialized
   balances and the Core records.
8. Perform any real-payout UAT only under a new explicit approval. Assert the signed
   final callback, one settlement, balanced principal and fee journals, transaction
   hash uniqueness, and matching customer/Admin views.

GitHub publication, PostgreSQL migration, each Render deployment, flag activation,
and real-money UAT are separate evidence items.

## Historical reconciliation boundary

Migration `0011` never creates accounting intents for existing withdrawals. Before
adding one manually, identify the exact tenant, customer, wallet binding, amount,
fee, net amount, custody status, Cregis CID, and transaction hash. Require a backup
checksum, isolated restore-test time, named approver, and reason. Completed custody
records must not be credited or debited from an aggregate calculation.

If an old completed withdrawal was already reflected in Core, link it only after
proving the exact existing Operation, CryptoTransfer, journals, and materialized
balance effect. If it was not reflected, use a separately reviewed compensating
accounting transaction. Never rewrite a historical journal, edit a balance, reuse a
transaction hash, or silently bind a different wallet.

## Acceptance invariants

- one custody withdrawal maps to one accounting intent, Core Operation, and Core
  CryptoTransfer;
- the customer Account and CryptoWallet always freeze, consume, or release the same
  total amount in one serializable transaction;
- the on-chain net amount plus stored fee equals the total customer debit exactly;
- only a signed completed callback with a 64-hex TRON transaction hash can settle;
- settlement posts a balanced principal journal and, when non-zero, a balanced fee
  journal before marking the intent `settled`;
- rejection, failure, or cancellation releases frozen value before the public state
  becomes final;
- duplicate requests, callbacks, transaction hashes, and Core references cannot
  create a second financial effect;
- `/ledger/reconciliation/usdt` reports any custody/Core/accounting mismatch, and
  the Admin reconciliation page cannot show success while such an issue exists.

Any invariant failure remains `exception` and blocks further execution until an
audited reconciliation is approved.
