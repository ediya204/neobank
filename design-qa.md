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
- The page keeps the existing Moventra customer-portal navigation, typography, radii, shadows, and neutral/blue token system rather than copying the reference's unrelated admin chrome.

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
- Send flow validates a TRC20 address, calculates 12 USDT gross / 1 USDT fee / 11 USDT net, opens confirmation, and submits a pending independent-review record.
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
