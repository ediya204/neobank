**Design QA**

- Source visual truth: user-supplied receive-wallet reference screenshot (session-only, not committed)
- Implementation screenshot: local design-QA evidence under ignored `work/design-qa/`
- Combined comparison: local side-by-side evidence under ignored `work/design-qa/`
- Route: `http://localhost:3002/portal/crypto-wallet/deposit`
- State: business customer, USDT, BNB Smart Chain (BEP20), funded wallet, QR and recent deposits loaded
- Viewport: responsive browser viewport, 735 CSS px wide; full-page capture
- Source pixels: 3134 x 1247
- Implementation pixels: 735 x 1992
- Density normalization: source downsampled to 735 x 292 and padded on white; implementation retained at 735 x 1992. The source is an ultra-wide operations layout, while the implementation intentionally adapts the same information hierarchy to the customer portal's responsive viewport.

**Full-view comparison evidence**

- The implementation preserves the reference's three-step receive flow, network selector, address/copy action, QR code, right-side notices, and recent-deposit history.
- At the narrower responsive breakpoint, the notice card moves below the receive card and the history table becomes horizontally scrollable. This is an intentional responsive adaptation rather than missing content.
- The page keeps the existing SSC Digital Bank customer-portal navigation, typography, radii, shadows, and neutral/blue token system rather than copying the reference's unrelated admin chrome.

**Focused region comparison evidence**

- Address and QR region: the selected network, exact deposit address, copy affordance, network-only warning, custody boundary, and real QR are all visible and aligned as one task block.
- Recent deposits region: status, direction, chain/network, gross amount, credited amount, TXID, timestamp, and record detail affordance are retained.
- Typography: hierarchy, weights, line height, wrapping, and small helper copy remain readable at the responsive breakpoint.
- Spacing/layout: step rhythm, card padding, section gaps, radii, and elevation are consistent with the existing portal.
- Colors/tokens: blue progress states, green safe-deposit notice, neutral surfaces, and semantic status colors have sufficient contrast.
- Image quality/assets: QR output is generated from the actual wallet address; cryptocurrency and navigation icons come from the project's icon library, with no placeholder graphics.
- Copy/content: customer-facing Chinese copy clearly distinguishes local workflow validation from future Cregis custody and real chain settlement.

**Findings**

- No actionable P0, P1, or P2 visual differences remain.
- [P3] The compact recent-deposit table requires horizontal scrolling at the 735 px breakpoint. This retains the complete financial record instead of hiding fields; a future optional mobile card view could reduce scanning effort.

**Comparison history**

1. Initial browser pass: the QR endpoint returned no image, leaving the reference's key receive artifact absent (P1). Fixed the server QR import/response path and reloaded the implementation. Post-fix evidence: `deposit-responsive.jpg` shows a sharp, address-derived QR.
2. Initial overview pass: the dark receive CTA had insufficient distinction from the surrounding hero treatment (P2). Updated the CTA to a white surface with dark text. Subsequent browser pass confirmed the corrected contrast and hierarchy.
3. Final side-by-side pass: `source-vs-implementation.jpg` found no remaining actionable P0/P1/P2 differences across typography, spacing, color, assets, copy, core affordances, or responsive structure.

**Primary interactions tested**

- Wallet balances load for TRON, BSC, and Ethereum.
- Receive flow loads the selected network address, copy control, network warning, QR, and recent deposits.
- Earlier pre-whitelist send-flow evidence validated a TRC20 address, fee calculation, confirmation, and pending independent review; the current whitelist-only flow is covered in the later QA section.
- Desktop and responsive portal navigation remain usable.
- Browser console was checked after the final fix; no new application errors or selector warnings were emitted.

**Implementation checklist**

- [x] Three-chain USDT wallet balances
- [x] Receive address and QR flow
- [x] Send form, fee preview, confirmation, and submission
- [x] Independent review workflow
- [x] Transaction history and detail access
- [x] Responsive customer-portal layout
- [x] Local Cregis boundary communicated in UI

final result: passed

## Admin navigation normalization — 2026-08-19

**Source visual truth**

- Screenshot: `/Users/edi/.codex/visualizations/2026/08/19/neobook-navigation-audit/01-current-navigation.png`
- Route: `https://portal.sscdigitalbank.com/dashboard/operations/crypto-wallets`
- State: production Admin sidebar before this local change. It mixes customer, balance, transaction,
  accounting, payout, channel, and sweep capabilities in overlapping groups and labels the USDT payout
  workflow as `数字钱包审批`.

**Implementation evidence**

- Screenshot: `/Users/edi/.codex/visualizations/2026/08/19/neobook-navigation-audit/02-normalized-navigation.png`
- Route: `http://localhost:3002/dashboard/overview`
- State: local authenticated Admin with the canonical navigation groups and normalized overview shortcuts.
- Browser DOM assertions covered all 18 visible routes plus three compatibility routes.

**Audit steps and health**

1. Navigation hierarchy — passed: one capability appears once under `客户与账户`, `资金处理`,
   `换汇管理`, or `账务查询`; the separate single-item sweep and system groups are removed.
2. Naming consistency — passed: sidebar, overview shortcuts, document title, and page heading agree for
   onboarding, VA applications, customer accounts, deposits, fiat payouts, USDT payouts, approvals,
   adjustments, automatic conversion, transactions, and ledger entries.
3. Route semantics — passed: reconciliation renders `ReconciliationPage` instead of aliasing the ledger.
   The legacy D1-backed audit route is excluded from the Render-only navigation and resolves to 404.
4. Duplicate compatibility — passed: `/dashboard/operations/balances` redirects to
   `/dashboard/accounts`; `/dashboard/usdt-sweeps` redirects to
   `/dashboard/operations/crypto-wallets` without producing a second menu entry.
5. Runtime rendering — passed for navigation scope: all visible pages rendered without a development
   error overlay; the removed legacy audit URL resolves to the explicit not-found page.

**Visual comparison**

- The existing logo, typography, icon family, spacing, selection color, and sidebar width are preserved.
- The change is information architecture and nomenclature only; it introduces no new visual system.
- No actionable P0, P1, or P2 visual mismatch remains in the audited desktop state.

final result: passed

---

**Withdrawal whitelist and OTP QA — 2026-08-18**

**Visual truth and evidence**

- Source visual truth: `/var/folders/1v/wprpp7c56hg5_qzt15k1t2240000gn/T/codex-clipboard-56e92fb5-ba79-4786-9213-7efbae2ad65f.png`
- Browser-rendered implementation: `work/design-qa/withdrawal-whitelist-final-clip.png`
- OTP dialog: `work/design-qa/withdrawal-whitelist-otp-dialog-final.png`
- Side-by-side comparison: `work/design-qa/withdrawal-whitelist-source-vs-final.png`
- Route: `http://localhost:3002/portal/crypto-wallet/withdraw`
- State: funded USDT-TRC20 wallet with no active withdrawal-address whitelist entries
- Primary viewport: 855 x 534 CSS px; source and focused implementation evidence are both 855 x 534 pixels with no density normalization
- Responsive check: 390 x 844 CSS px; document width and scroll width were both 390 px

**Full-view comparison evidence**

- The implementation preserves the source form hierarchy, USDT asset presentation, TRON network selector, outlined controls, typography, radii, and neutral card treatment.
- The source's free-form destination input is intentionally replaced by a disabled empty-state whitelist selector. The adjacent helper text says that only OTP-verified TRC20 addresses are accepted, and the add action remains available when the list is empty.
- Existing SSC customer-portal chrome remains visible rather than reproducing the cropped reference's surrounding navigation.

**Focused region comparison evidence**

- Typography: heading, field labels, values, and helper copy retain the portal's existing family, weights, line height, wrapping, and optical hierarchy. No truncation affects the whitelist decision.
- Spacing and layout: field rhythm, card padding, selector height, borders, radii, and vertical alignment match the existing withdrawal form and the supplied source.
- Colors and tokens: neutral surfaces and borders, green USDT icon, muted helper text, blue informational OTP alert, green verified state, and amber irreversible-transfer warning use existing semantic tokens with readable contrast.
- Assets: the existing project logo and icon library are retained; no placeholder, emoji, handwritten SVG, or code-drawn asset was introduced.
- Copy: the UI distinguishes an OTP-verified withdrawal whitelist address from a Cregis deposit address and warns that nobody will request the OTP by email, chat, or phone.
- OTP dialog: label, immutable TRON address, six-digit OTP, explanatory text, disabled-until-valid CTA, cancellation, and irreversible-transfer warning fit without clipping at the desktop viewport. The dialog was rendered with a temporary local visual-open harness; the source condition was restored immediately after capture.
- Responsive behavior: the form stacks at 390 px with no horizontal document overflow; persistent bottom navigation remains available.

**Findings**

- No actionable P0, P1, or P2 visual differences remain.
- Expected product change: manual destination entry from the reference is deliberately removed because the requested security model requires selecting an active whitelist record.
- Residual test gap: the available local browser session is a tenant/operator demo session, so a real customer-session OTP submission was not performed. Backend tests, route tests, and the browser-rendered dialog cover the implementation without creating a withdrawal or transmitting a real OTP.

**Comparison history**

1. Initial source review found that the add-address action was nested inside a disabled form control when the whitelist was empty (P1). Moved the action outside the disabled selector and confirmed in the browser that it remains enabled while submission remains disabled.
2. The first local dialog harness used an explicit boolean value and triggered the repository's JSX lint overlay (P1 QA harness issue). Replaced it with a lint-compliant temporary visual-open attribute, captured the dialog, restored the real condition, and confirmed the final page emits no console warnings or errors.
3. Final 855 x 534 side-by-side review found no remaining actionable mismatch across typography, spacing, color, assets, copy, or the core whitelist affordance.

**Primary interactions tested**

- Withdrawal data and wallet balance load successfully.
- An empty whitelist disables destination selection and withdrawal submission while leaving the add-address action available.
- The OTP dialog renders all required fields and keeps `验证并添加` disabled until label, TRON address, and six-digit OTP are present.
- Desktop and 390 px responsive layouts remain usable without document-level horizontal overflow.
- Browser console was checked after restoring the production condition; no warnings or errors remained.
- No address was persisted, no real OTP was entered, and no withdrawal was created.

**Implementation checklist**

- [x] Free-form withdrawal destination removed
- [x] Active whitelist-only selector
- [x] OTP-only add-address dialog
- [x] Empty-state add action remains available
- [x] Confirmation includes whitelist name and immutable address
- [x] Responsive and console checks

final result: passed

---

# Customer asset rows design QA — 2026-08-19

**Source visual truth**

- Path: `/var/folders/1v/wprpp7c56hg5_qzt15k1t2240000gn/T/codex-clipboard-f3489e8b-2969-462c-9c54-cde90b24085b.png`
- Source pixels: 1048 x 721.
- State: existing Admin customer detail, `账户与 VA` selected, table-based account presentation.
- Product requirement layered onto the source: replace the database-oriented table with three
  vertically stacked product rows named `系统钱包`, `VA 钱包`, and `数字货币钱包`, with the
  corresponding asset state shown inside each row.

**Implementation evidence**

- Screenshot: `/Users/edi/.codex/visualizations/2026/08/19/neobook-customer-assets/02-three-wallet-rows.png`
- Route: `http://localhost:3002/dashboard/customers/cus_demo_individual`
- Browser viewport: 1356 CSS pixels wide; document client and scroll widths were both 1341 pixels.
- Screenshot pixels: 1341 x 1845 full-page capture.
- State: local isolated Admin customer, `账户与 VA` selected, populated system, VA, and USDT/TRON
  wallet data.
- Browser page: no development error overlay after loading and selecting the asset tab; ESLint,
  TypeScript, iconography and production-build gates passed. The current browser-control surface
  did not expose historical console messages.

**Full-view comparison evidence**

- Information architecture intentionally changes from a seven-column technical table to three
  vertically stacked product rows while preserving the source page shell, tabs, border radius, typography,
  neutral surfaces, semantic status colors, and VA request history.
- System wallets show separate USD and HKD assets; VA wallets show their bank-assigned account
  metadata and fiat assets; the digital-currency wallet shows USDT/TRON network, address state,
  balance, minimum deposit, and fee.
- Each account exposes labelled book, available, and frozen balances. No cross-currency total is
  calculated.

**Focused region comparison evidence**

- A separate crop was not required: the implementation full-page screenshot preserves the wallet
  panel at 1341 physical pixels, where headers, amounts, status labels, account numbers, bank data,
  and network metadata remain readable.

**Required fidelity surfaces**

- Fonts and typography: inherited from the existing MUI theme; heading, label, metric, and metadata
  weights follow the source hierarchy without introducing a new font.
- Spacing and layout rhythm: the panel keeps the source outer spacing and radius; equal desktop
  rows use internal separators, while multiple accounts inside one row use equal-width cards.
- Colors and visual tokens: existing `background`, `action.hover`, `divider`, and semantic Label
  tokens are reused; there are no decorative gradients or unapproved palette changes.
- Image and icon quality: existing AssetIcon mappings provide real currency and TRON icons; existing
  semantic iconography provides wallet and bank icons. No placeholder, emoji, custom SVG, or CSS
  drawing replaces an asset.
- Copy and content: product-facing Chinese labels replace raw `SYSTEM_WALLET` and similar database
  enums. Empty states explain when each product will appear.

**Findings**

- No actionable P0, P1, or P2 mismatch remains. The intentional structural difference is the user
  requirement, not design drift.

**Comparison history**

- Pass 1: source and implementation were opened together. The three requested product dimensions,
  associated assets, metadata readability, theme consistency, and desktop overflow were verified;
  no P0/P1/P2 visual fix was required after capture.

**Implementation checklist**

- [x] Three vertically stacked product rows at desktop width.
- [x] Multiple accounts remain grouped inside their product row.
- [ ] Narrow-viewport runtime capture was not available in the current in-app browser; the source
      breakpoint stacks account cards to one column below the MUI `md` breakpoint.
- [x] System, VA, and digital-wallet data remain separated.
- [x] Book, available, and frozen balances are labelled per asset.
- [x] Bank, account, IBAN, SWIFT/BIC, network, address, minimum deposit, and fee render when applicable.
- [x] Existing VA request history remains available below the asset view.

**Follow-up polish**

- None required for this pass.

final result: passed
