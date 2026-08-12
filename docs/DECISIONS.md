# Product and engineering decisions

This file summarizes decisions reached during prior collaboration. Revisit a
decision when the user explicitly changes the business model or current code shows
that the assumption no longer applies.

## Financial model

- Current V1 business flow is: manually record fiat receipt, keep it pending until
  explicit clearing, automatically convert cleared fiat to USDT/TRON, then let an
  authorized administrator perform a controlled USDT sweep.
- Admin data entry is not settlement. Preserve pending, cleared, exception, and
  reconciliation states and their audit trail.
- Customer-initiated fiat withdrawal, USDT deposit, manual OTC, and customer
  withdrawal are outside the current V1 write flow. Historical records remain
  readable; do not destroy old data merely because new creation is disabled.
- Automatic conversion records remain visible and auditable even when customers
  cannot create OTC orders.
- A submitted sweep with a transaction hash must not be treated like an unsubmitted
  locked batch. Cancellation and completion rules must prevent value reuse.

## Partner integration

- Webhook and query APIs are complementary, not substitutes.
- Webhook provides timely notification. Consumers verify signatures, deduplicate,
  tolerate reordering, persist before processing, and return success promptly.
- Sweep-batch endpoints provide active reconciliation and missed-event recovery.
- Transaction history provides the completed accounting record.
- Batch and customer access is explicitly Partner-scoped. A real batch ID belonging
  to another Partner returns the same not-found response as a nonexistent ID.
- Partner responses must not expose operator notes, staff identity, internal tenant
  keys, address configuration versions, or internal Webhook delivery status.

## Security and operations

- Partner machine authentication and human Portal authentication are separate
  trust boundaries.
- Cloudflare Access redirects or denials prove only the edge behavior tested; they
  do not prove Worker business acceptance.
- Webhook endpoints must be protected against SSRF and DNS rebinding at delivery
  time, not only when the endpoint is approved.
- Financial and migration operations must be recoverable and auditable: inspect,
  back up, checksum, restore-test, approve, execute, and verify.
- GitHub push, Worker deployment, and D1 migration are three separate operations.

## Documentation

- Partner API machine field names, enums, examples, and release metadata must stay
  synchronized across OpenAPI, English and Chinese source guides, and generated
  Portal documents.
- Documentation describes verified capabilities and boundaries. It must not turn a
  proposed feature or local-only result into a production claim.
