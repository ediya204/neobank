# Cregis direct accounting runbook

Status: implemented behind fail-closed flags; not deployed or enabled by this change.

## Boundary

The Go API owns Cregis signature verification, exact deposit lookup, custody records,
and callback evidence. Core owns every customer balance, freeze, release, settlement,
Operation, CryptoTransfer, and JournalEntry.

Go calls only these authenticated Core actions:

```text
POST /api/v1/internal/cregis/deposits/:id/post
POST /api/v1/internal/cregis/withdrawals/:id/reserve
POST /api/v1/internal/cregis/withdrawals/:id/approve
POST /api/v1/internal/cregis/withdrawals/:id/release
POST /api/v1/internal/cregis/withdrawals/:id/settle
```

The path contains only the durable PostgreSQL record id. Core reloads the tenant,
customer, asset, address, amount, fee, actors, custody status, and evidence from
PostgreSQL. The caller cannot submit or override a financial amount.

The endpoints require the dedicated `CORE_ACCOUNTING_SHARED_SECRET`, the exact signed
identity `service:neobank-go`, and the existing timestamp, request-target, identity,
and body-hash HMAC format. They are disabled unless
`CREGIS_DIRECT_ACCOUNTING_ENABLED=true` on both Core and Go.

## Callback acknowledgement

| Condition                                              | HTTP response to Cregis | Money result             |
| ------------------------------------------------------ | ----------------------- | ------------------------ |
| invalid signature or malformed payload                 | non-success             | none                     |
| custody/Core/database failure before a durable result  | non-success / retry     | none or unchanged        |
| posted, settled, released, or exact duplicate          | literal `success`       | exactly once             |
| callback evidence stored but permanently contradictory | literal `success`       | unchanged; manual review |

Delivery acknowledgement is not financial completion. Customer and Admin views use
the Core accounting state, not callback transport status.

## Withdrawal ordering

1. The custody row and accounting record are created.
2. Core synchronously reserves total customer debit (`net + fee`).
3. Admin approval synchronously advances the linked Core records.
4. Only an `approved` accounting record can be submitted to Cregis.
5. Submission timeout or an invalid response remains `exception` with funds frozen.
6. Signed Cregis `2`, `4`, or `7` synchronously releases the full freeze.
7. Signed Cregis `6` consumes the freeze and posts principal plus fee journals.

The SQL admission check that subtracts very short-lived `pending_reservation` rows is
retained as a fail-closed concurrency guard across the Go-to-Core HTTP boundary. It
does not post or freeze money; Core remains the only balance authority.

## Rollout and rollback

1. Back up the complete production PostgreSQL database, record SHA-256, restore it
   into isolated PostgreSQL 17, and verify row counts and financial invariants.
2. Deploy Core and Go from the same reviewed commit with direct accounting disabled.
3. Configure the internal Core origin and a new dedicated secret without exposing
   either value. Keep the old worker processing flag false.
4. Read-only verify migrations `0010` and `0011`, queue counts, Core system accounts,
   mirrored balances, journals, tenant scope, and callback evidence.
5. Enable direct accounting on Core first and Go second, then run an approved
   deposit-only test.
6. Run an approved no-payout withdrawal reservation and Admin rejection test.
7. Enable customer withdrawal creation only after both materialized balances freeze
   and release identically and reconciliation remains green.
8. A real payout requires a new explicit approval.

Rollback is flag-only: disable direct accounting on Go first so it stops invoking
Core, then disable it on Core. Do not enable the polling worker automatically. Its
activation requires a separate queue inspection and approval because replaying an
unknown historical queue can move customer money.

Remove `neobank-financial-accounting-worker` only after all historical rows have an
evidenced disposition, no new flow depends on polling, and the direct path has passed
the reconciliation observation window. Keep the accounting tables as audit evidence.
