# Cregis withdrawal accounting runbook

## Authority and state order

The Core journal is the only customer-money authority. Cregis records custody
submission and final chain evidence; neither a Go status nor a callback may edit a
customer balance directly.

```text
customer request
  -> PostgreSQL custody row + accounting intent
  -> authenticated synchronous Core serializable reservation
       (Account + CryptoWallet frozen together)
  -> Admin approval recorded in custody
  -> Core Operation + CryptoTransfer move to PROCESSING
  -> Cregis submission
  -> signed final callback + exact Cregis payout-order query
       (destination + net amount + currency + status + reference + txid)
  -> synchronous Core hand-off after callback evidence is conflict-free
       completed -> Core consumes frozen funds and posts principal + fee journals
       failed/rejected/cancelled -> Core releases both frozen balances
  -> customer and Admin read the Core result
```

`WITHDRAWAL_ACCOUNTING_ENABLED` defaults to `false`. Enabling it without migration
`0011_cregis_withdrawal_accounting` is a startup error. A request cannot be approved
until its accounting intent is `reserved`; it cannot be executed until the Core
approval hand-off is `approved`. With direct accounting enabled, the request does
not return business success until the relevant Core result is committed. Queue
statuses remain durable state and idempotency evidence; the polling worker is not
required for new requests.

Before any release or settlement, Go queries `POST /api/v1/payout/query` by the Cregis
CID and compares the provider order with both the signed callback and the immutable
PostgreSQL withdrawal. A mismatch is stored as callback evidence, moves the custody
row to `exception`, returns literal `success`, and leaves the Core freeze unchanged.
Core independently rejects release or settlement when stored payout callback families
conflict. This extra check is deliberate even though Cregis documents final callback
statuses `2`, `4`, `6`, and `7` as mutually exclusive and emitted only once.

## Release order

These are separate, manually approved changes:

1. Disable customer withdrawal creation and manual OTC writes.
2. Take a complete Render PostgreSQL backup, record its SHA-256, restore it to an
   isolated PostgreSQL 17 instance, and verify financial row counts and balances.
3. Review and apply migrations `0010` and `0011` in order. Confirm both new queues
   contain no historical rows.
4. Deploy Core and Go from the same reviewed commit with
   `WITHDRAWAL_ACCOUNTING_ENABLED=false` and
   `CREGIS_DIRECT_ACCOUNTING_ENABLED=false`. Keep the old worker paused with
   `FINANCIAL_ACCOUNTING_PROCESSING_ENABLED=false`.
5. Configure the dedicated Core accounting URL and secret. Verify queue state and
   Core USDT clearing and fee accounts separately through read-only PostgreSQL
   checks. Verify the
   customer endpoint remains closed and the USDT reconciliation endpoint is green.
6. Reconcile historical deposits and withdrawals one item at a time under a separate
   approval. Never infer customer money from aggregate custody history.
7. After an approved authenticated deposit test, set
   `CREGIS_DIRECT_ACCOUNTING_ENABLED=true` on Core first and Go second. Then set
   `WITHDRAWAL_ACCOUNTING_ENABLED=true` only after an explicitly approved no-payout
   reservation/rejection UAT proves freeze and release in both materialized balances
   and the Core records.
8. Perform any real-payout UAT only under a new explicit approval. Assert the signed
   final callback, one settlement, balanced principal and fee journals, transaction
   hash uniqueness, and matching customer/Admin views.
9. Remove the old accounting worker only after all historical rows are resolved and
   the direct path has no reconciliation issues. Retain audit tables initially.

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

For a historical withdrawal with a signed rejected or failed Cregis callback, use
the PostgreSQL-only reconciliation command. `preview` is read-only and may list the
candidate set or inspect one exact withdrawal:

```bash
npm --prefix server run build
npm --prefix server run withdrawal:reconcile -- preview
npm --prefix server run withdrawal:reconcile -- preview --withdrawal-id WITHDRAWAL_ID
```

The command rejects any completed callback, transaction hash, existing journal,
ambiguous Core match, amount/address mismatch, non-mirrored Account and CryptoWallet,
or insufficient frozen balance. A candidate with no Core Operation is classified as
`no_core_reservation`; closing it changes no balance. One exact linked Core reservation
is classified as `linked_core_reservation` and may release only that stored total.

Mutations are deliberately split into two invocations. `hold` creates a non-queued
manual reconciliation record and does not change custody status or money. Both steps
require a complete PostgreSQL backup checksum, an isolated restore test, a named
approver, and an exact reason supplied through hidden environment input. `release`
also requires the separate `WITHDRAWAL_RECONCILIATION_RELEASE_APPROVED=true` gate:

```bash
npm --prefix server run withdrawal:reconcile -- hold --withdrawal-id WITHDRAWAL_ID
npm --prefix server run withdrawal:reconcile -- release --withdrawal-id WITHDRAWAL_ID
```

Do not paste approval values, backup checksums, database URLs, or customer evidence
into chat, source, shell history, or tickets. After `release`, the command only changes
the custody row to its signed terminal result and queues `pending_release`. The
separately approved Core accounting execution performs the serializable balance
change. Verify the accounting row
reaches `released`, both frozen balances decrease by the exact total, both available
balances increase by the same total, linked Core records become `REJECTED` or `FAILED`,
and `/ledger/reconciliation/usdt` no longer reports the item.

## Operator status and copy standard

The operator UI must present three independent facts. A custody status such as
`exception`, `failed`, or `provider_rejected` must never be used by itself to claim
that funds are frozen, released, or debited.

1. **Instruction status** — approval, submission, exception, rejection, or completion.
2. **Cregis / chain result** — not submitted, awaiting signed final callback, rejected
   without TXID, or completed with TXID.
3. **Core funds status** — derived from the accounting link and exact Core operation
   evidence.

The history API exposes `funds_status` using this closed vocabulary:

| `funds_status`        | Operator meaning                                         | Permitted action                                    |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `not_reserved`        | This instruction did not create a Core funds reservation | No refund, release, or CID association              |
| `reservation_pending` | Core reservation has not finished                        | Retry the authenticated Core hand-off               |
| `frozen`              | The instruction has a verified Core reservation          | Follow the instruction and callback state gate      |
| `release_pending`     | A verified reservation is being released                 | Retry Core; do not edit balances                    |
| `released`            | The verified reservation was released                    | No further funds action                             |
| `settlement_pending`  | A signed completion is awaiting Core settlement          | Retry the authenticated Core hand-off               |
| `settled`             | Core settlement completed                                | No further funds action                             |
| `review_required`     | Evidence is incomplete or contradictory                  | Read-only investigation; do not infer a funds state |

`can_reconcile_cregis_cid` is `true` only for an `exception` row whose accounting
record is `approved` and has both a Core operation and Core transfer. The UI must fail
closed: it shows the CID association action only when this field is exactly `true` and
`funds_status` is exactly `frozen`. The reconcile write endpoint enforces the same
predicate.

Terminal historical rows with no accounting link, no exact Core operation, no CID,
and no TXID are shown as `failed`, `rejected`, or `cancelled` with **no funds impact**.
A signed Cregis rejection remains visible as an auditable provider rejection, but if
`funds_status=not_reserved` the copy must say that no refund or release is required.
Historical-state closure remains a separate, approved workflow and must not mutate
balances directly.

## Admin reconciliation triage

The Admin reconciliation page classifies missing intents without mutating funds:

- exactly one signed rejected or failed callback makes the item eligible for the
  guarded single-record `preview` / `hold` / `release` flow;
- `executing` or `submitted_to_cregis` without final evidence remains blocked while
  the operator waits for and verifies Cregis and chain finality;
- a terminal-looking custody status without final callback evidence remains blocked;
- a completed callback or completed custody status must not use the release command;
  it requires exact settlement evidence and a separately approved compensating
  accounting review;
- conflicting completed/rejected/failed callback evidence is critical and disables
  manual reconciliation eligibility.

The page is advisory and read-only. It does not replace the command's validation,
the complete PostgreSQL backup, checksum, isolated restore proof, named approval,
or post-release invariant checks.

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
