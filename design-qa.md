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
