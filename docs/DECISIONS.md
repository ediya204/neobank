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
- A customer cannot manually declare or complete a USDT deposit. A signed Cregis
  callback, followed by an exact Cregis trade lookup, is the external settlement
  evidence that starts the system-owned deposit workflow. Manual OTC remains
  outside the current V1 write flow. Historical records remain readable; do not
  destroy old data merely because new creation is disabled.
- Cregis custody facts and customer money have different authority. The Go service
  verifies and durably stores the external deposit plus an accounting intent in one
  PostgreSQL transaction. A dedicated Core worker then atomically creates the
  completed Operation, CryptoTransfer, balanced JournalEntry, and both USDT
  materialized balances. Only the Core journal is the final accounting authority.
  Until that transaction commits, both customer and Admin histories show the
  deposit as processing and the amount is unavailable.
- Cregis callback delivery is at least once; the financial result is exactly once.
  Tenant + Cregis CID, completed transaction hash, Core operation reference, and
  customer idempotency key are independently unique. Duplicate delivery may retry
  transport but cannot create a second journal or balance credit. An invariant
  conflict enters exception instead of guessing or overwriting a wallet binding.
- PostgreSQL migration `0010_cregis_deposit_accounting` never backfills historical
  deposits. Historical reconciliation is a two-step held-then-release workflow for
  one exact deposit and requires a backup checksum, isolated restore-test evidence,
  named approval, and reason. Applying a migration or deploying a worker must not
  move historical customer money.
- New Cregis withdrawals use the same Core authority boundary. The customer request
  creates a custody row plus accounting intent; a Core serializable transaction must
  freeze the matching Account and CryptoWallet before Admin approval or Cregis
  execution is possible. A signed final callback queues either Core settlement or
  release. Only the Core transaction may consume frozen funds, post principal and fee
  journals, or expose a final customer balance.
- `WITHDRAWAL_ACCOUNTING_ENABLED` is fail-closed and PostgreSQL migration
  `0011_cregis_withdrawal_accounting` never enqueues historical withdrawals. Customer
  OTC now uses the Core state machine and balanced journal: the first request creates
  a non-reserving `DRAFT` quote for five seconds, and authenticated confirmation
  atomically completes the conversion without administrator approval. Direct OTC
  operation creation remains blocked so clients cannot bypass confirmation.
- Automatic and customer-confirmed conversion records remain visible and auditable.
- A submitted sweep with a transaction hash must not be treated like an unsubmitted
  locked batch. Cancellation and completion rules must prevent value reuse.
- Withdrawal fees are versioned by asset class, currency, payout method, channel,
  and network. Fiat and crypto creation must resolve the server-side active rule and
  store a transaction snapshot; later fee changes affect only new submissions.
- Customer fee management enumerates every configured fiat payout path and currency,
  even when no active organization default exists. Missing defaults remain an explicit
  blocking state with a management link; the UI never invents a zero fee. An isolated
  customer override may be configured for that scope and becomes the effective rule.
- Fiat payout amounts represent the beneficiary principal and the fee is added to
  the account reservation. Cregis customer input represents the total wallet debit;
  only the stored net amount is submitted on-chain. Stale fee confirmation requires
  explicit customer reconfirmation.
- FX/OTC rate versions configure only a fee policy for a supported currency pair.
  Customer quotes must be calculated from the current FastForex midpoint plus that
  fee on every display and refreshed again when the server creates a transaction
  quote. The operation stores the provider midpoint, fee, final rate, amount, and
  timestamps. OTC posts that immutable snapshot only when the customer confirms
  within five seconds; expiration never reserves or moves funds. A rate version's
  creation-time midpoint is audit evidence only and must never become the runtime
  pricing baseline.
- USD portfolio valuations use current FastForex quotes for every non-USD asset,
  including USDT. Missing provider data produces an explicit partial valuation;
  stored fee-policy snapshots and assumed stablecoin parity are not fallbacks.
- In the Neobank profile, manual KYC approval is the final account-opening gate.
  For new individual applications that have a Sumsub verification record, approval
  is allowed only after the dedicated `neobank_individual_v1` Level reports GREEN
  for passport identity, liveness/face, and proof of residence. A Sumsub result never
  auto-approves, auto-activates, or provisions an account. Applications created
  before this integration remain on the documented legacy manual-review path;
  business KYB is unchanged.
  Approval automatically activates the customer, assigns zero-balance USD and HKD
  standard fiat accounts, and idempotently provisions one Cregis-verified
  USDT-TRC20 wallet. Core customer synchronization repairs any missing standard fiat
  account idempotently; no manual fiat-account opening action is exposed. This
  removes the separate Operations, fiat-account, and wallet approval clicks, but
  does not approve, execute, or settle any withdrawal.
- Admin KYC decisions are made only in the dedicated
  `/dashboard/onboarding/:id/review` workspace. The workspace records an explicit
  decision, reviewer checklist, reason/note, reviewer identity, and review time;
  generic customer-detail views may link to that record but must not expose direct
  KYC approve/reject shortcuts. `/dashboard/onboarding` contains pending and
  rejected applications, while `/dashboard/customers` contains only KYC-approved
  customers and presents their actual account, wallet, balance, and sync state.
- Customer detail groups holdings by product dimension rather than database enum:
  system wallets, VA wallets, and digital-currency wallets are three explicit
  vertically stacked rows. Each row shows its own account metadata, book/available/frozen assets,
  and operational state; fiat and USDT balances are never combined into an
  unlabelled cross-currency total.
- Admin navigation uses one canonical entry per business capability. The visible
  groups are Workbench, Customers & Accounts, Fund Processing, FX Management, and
  Accounting Queries. Duplicate balance and USDT routes remain redirects only;
  reconciliation renders the reconciliation workspace. A single administrator does
  not use a standalone business-approval page: overview reminders link to status-
  filtered transaction records, whose existing detail view retains explicit approve,
  reject, and execute actions and the complete audit trail. The old approval route is
  a compatibility redirect. The legacy audit page is not exposed in the Render-only
  navigation and resolves to 404 until a PostgreSQL audit store and API exist.

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
- 银行名称、国家/地区、地址与 SWIFT/BIC 是渠道固定资料；通道不配置分行或
  收款/结算账号。运营批准申请时
  只录入银行实际分配的账户名称、账号和可选 IBAN；开通账户保存固定资料快照，
  后续修改渠道不会静默改写历史 VA。
- `VIRTUAL_ACCOUNT` 是同一家银行的统一 VA 能力配置：开户批准后账户保存
  `fundingChannelId`，VA 出款必须复用该账户绑定的银行渠道，不能另选独立
  `VA_PAYOUT`。旧 `VA_PAYOUT` 仅保留历史读取兼容，禁止新建或重新启用。
- 客户开户完成后可从 Portal 选择已启用的 VA 银行、受支持币种和账户用途提交
  `SUBMITTED` 申请。Admin 只在独立的
  `/dashboard/operations/virtual-accounts` 队列及其详情页处理：批准时只能录入银行
  实际分配的账户名称、账号和可选 IBAN，不能改变客户所选银行、币种或用途；拒绝
  必须记录客户可见原因。KYC 开户队列、通用资金记录页和客户详情均不得提供
  VA 快捷批准动作。

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
