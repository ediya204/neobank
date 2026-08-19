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
- Withdrawal fees are versioned by asset class, currency, payout method, channel,
  and network. Fiat and crypto creation must resolve the server-side active rule and
  store a transaction snapshot; later fee changes affect only new submissions.
- Fiat payout amounts represent the beneficiary principal and the fee is added to
  the account reservation. Cregis customer input represents the total wallet debit;
  only the stored net amount is submitted on-chain. Stale fee confirmation requires
  explicit customer reconfirmation.
- FX/OTC rate versions configure only a fee policy for a supported currency pair.
  Customer quotes must be calculated from the current FastForex midpoint plus that
  fee on every display and refreshed again at operation submission. The submitted
  operation stores the provider midpoint, fee, final rate, amount, and timestamps;
  later approval posts that immutable transaction snapshot. A rate version's
  creation-time midpoint is audit evidence only and must never become the runtime
  pricing baseline.
- USD portfolio valuations use current FastForex quotes for every non-USD asset,
  including USDT. Missing provider data produces an explicit partial valuation;
  stored fee-policy snapshots and assumed stablecoin parity are not fallbacks.
- In the Neobank profile, manual KYC approval is the final account-opening gate.
  Approval automatically activates the customer and idempotently provisions one
  Cregis-verified USDT-TRC20 wallet. This removes the separate Operations and wallet
  approval clicks, but does not approve, execute, or settle any withdrawal.

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
- VA 开户必须绑定后台已启用的 `VIRTUAL_ACCOUNT` 银行渠道。客户先选择银行，
  再从该银行声明的支持币种中选择开户币种；服务端重复校验渠道、币种和客户归属。
- 银行名称、国家/地区、地址、分行与 SWIFT/BIC 是渠道固定资料。运营批准申请时
  只录入银行实际分配的账户名称、账号和可选 IBAN；开通账户保存固定资料快照，
  后续修改渠道不会静默改写历史 VA。
- `VIRTUAL_ACCOUNT` 是同一家银行的统一 VA 能力配置：开户批准后账户保存
  `fundingChannelId`，VA 出款必须复用该账户绑定的银行渠道，不能另选独立
  `VA_PAYOUT`。旧 `VA_PAYOUT` 仅保留历史读取兼容，禁止新建或重新启用。

## Security and operations

- Render PostgreSQL is the only authoritative and supported business datastore.
  D1 is completely out of scope for new or changed work: do not consider it in
  code, architecture, comparisons, plans, fallbacks, tests, deployments,
  migrations, reviews, or acceptance. Existing D1 material is historical evidence
  only. Follow `docs/DATASTORE_POLICY.md`; only a new explicit user instruction
  specifically reversing that policy may change this decision.
- Partner machine authentication and human Portal authentication are separate
  trust boundaries.
- Cloudflare Access redirects or denials prove only the edge behavior tested; they
  do not prove Worker business acceptance.
- Webhook endpoints must be protected against SSRF and DNS rebinding at delivery
  time, not only when the endpoint is approved.
- Financial and migration operations must be recoverable and auditable: inspect,
  back up, checksum, restore-test, approve, execute, and verify.
- GitHub push, Cloudflare web deployment, Render deployment, and PostgreSQL
  migration are separate operations.

## Documentation

- Partner API machine field names, enums, examples, and release metadata must stay
  synchronized across OpenAPI, English and Chinese source guides, and generated
  Portal documents.
- Documentation describes verified capabilities and boundaries. It must not turn a
  proposed feature or local-only result into a production claim.
