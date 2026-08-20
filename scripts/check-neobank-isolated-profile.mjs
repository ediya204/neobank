import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

const [
  packageSource,
  neobankWrangler,
  router,
  authRoutes,
  authLayout,
  registrationPage,
  provider,
  roleAccess,
  adminPage,
  worker,
  renderConfig,
  goMain,
  deploymentMode,
  coreMain,
  coreEdgeAuth,
  onboardingPage,
  kycReviewPage,
  customerManagementPage,
  customerDetailPage,
  neobankCustomerHelper,
  vaRequestManagement,
  vaRequestReview,
  dashboardRoutes,
  dashboardNavigation,
  dashboardPaths,
  customerSync,
  customerAdmin,
  portalCustomerContext,
  portalLayout,
  customerCryptoWallet,
  virtualAccountsPage,
  financeWorkspace,
  coreApi,
  accountsService,
  coreReconciliation,
  depositAccountingWorker,
  withdrawalAccountingWorker,
  depositAccountingMigration,
  withdrawalAccountingMigration,
  cregisHandlers,
] = await Promise.all([
  read('package.json'),
  read('wrangler.neobank.jsonc'),
  read('src/routes/sections/index.tsx'),
  read('src/routes/sections/auth.tsx'),
  read('src/layouts/auth/classic.tsx'),
  read('src/sections/auth/jwt/jwt-register-view.tsx'),
  read('src/auth/context/jwt/auth-provider.tsx'),
  read('src/auth/role-access.ts'),
  read('src/pages/dashboard/crypto-operations.tsx'),
  read('worker-web/index.ts'),
  read('render.yaml'),
  read('server-go/cmd/api/main.go'),
  read('src/config/deployment-mode.ts'),
  read('server/src/main.ts'),
  read('server/src/security/edge-auth.ts'),
  read('src/pages/dashboard/onboarding-workspace.tsx'),
  read('src/pages/dashboard/kyc-review-workspace.tsx'),
  read('src/pages/dashboard/customer-management.tsx'),
  read('src/pages/dashboard/customer-detail.tsx'),
  read('src/features/customers/neobank-customer.ts'),
  read('src/pages/dashboard/va-request-management.tsx'),
  read('src/pages/dashboard/va-request-review.tsx'),
  read('src/routes/sections/dashboard.tsx'),
  read('src/layouts/dashboard/config-navigation.tsx'),
  read('src/routes/paths.ts'),
  read('server/src/customers/neobank-customer-sync.ts'),
  read('server-go/cmd/api/customer_admin.go'),
  read('src/features/finance/portal-customer-context.tsx'),
  read('src/layouts/portal/layout.tsx'),
  read('src/pages/portal/crypto-wallet.tsx'),
  read('src/pages/portal/virtual-accounts.tsx'),
  read('src/pages/dashboard/finance-workspace.tsx'),
  read('src/features/finance/core-api.ts'),
  read('server/src/accounts/accounts.service.ts'),
  read('src/pages/dashboard/core-reconciliation.tsx'),
  read('server/src/deposit-accounting/deposit-accounting.worker.ts'),
  read('server/src/deposit-accounting/withdrawal-accounting.worker.ts'),
  read('migrations-postgres/0010_cregis_deposit_accounting.sql'),
  read('migrations-postgres/0011_cregis_withdrawal_accounting.sql'),
  read('server-go/cmd/api/cregis_handlers.go'),
]);

const packageJson = JSON.parse(packageSource);
const scripts = packageJson.scripts || {};
const coreRenderService =
  renderConfig.match(/- type: web\s+name: neobank-core[\s\S]*?(?=\n  - type:)/)?.[0] || '';
const emailRenderService =
  renderConfig.match(/- type: worker\s+name: neobank-email-worker[\s\S]*?(?=\n  - type:)/)?.[0] || '';

assert.match(neobankWrangler, /"name": "neobank-web"/);
assert.match(neobankWrangler, /"pattern": "portal\.sscdigitalbank\.com"/);
assert.doesNotMatch(neobankWrangler, /"d1_databases"/);
assert.doesNotMatch(neobankWrangler, /"binding": "DB"/);
assert.match(neobankWrangler, /"ADMIN_AUTH_RATE_LIMITER"/);
assert.match(neobankWrangler, /"CORE_API_BASE_URL"/);
assert.match(neobankWrangler, /"CORE_EDGE_SHARED_SECRET"/);
assert.doesNotMatch(neobankWrangler, /CF_ACCESS_AUD/);

assert.match(
  scripts['neobank:build'] || '',
  /REACT_APP_NEOBANK_DEPLOYMENT_MODE=full-admin-wallet/,
  'neobank:build must compile the full-admin-wallet profile'
);
assert.match(scripts['neobank:build'] || '', /REACT_APP_CORE_API_URL=\/api\/core/);
assert.match(scripts['neobank:build'] || '', /REACT_APP_CORE_ORGANIZATION_ID=org_neobank/);
for (const name of ['neobank:deploy:prepared', 'neobank:deploy:dry-run:prepared']) {
  assert.match(
    scripts[name] || '',
    /--config wrangler\.neobank\.jsonc/,
    `${name} must name wrangler.neobank.jsonc explicitly`
  );
  assert.doesNotMatch(scripts[name], /npm run cf:/, `${name} must not call the VA API release`);
}

assert.match(router, /if \(IS_FULL_ADMIN_WALLET_DEPLOYMENT\) routes = fullAdminWalletRoutes/);
assert.match(router, /const fullAdminWalletRoutes =/);
assert.match(router, /<Navigate to="\/dashboard\/overview" replace \/>/);
assert.match(router, /\.\.\.dashboardRoutes/);
assert.match(router, /\.\.\.customerAuthRoutes/);
assert.match(router, /\.\.\.adminAuthRoutes/);
assert.match(router, /\.\.\.authRoutes/);
assert.match(router, /\.\.\.dashboardRoutes/);
assert.match(router, /path: '\/admin'/);
assert.match(router, /path: '\/admin\/neobank-crypto'/);
assert.match(router, /path: 'home', element: <CustomerHome \/>/);
assert.match(router, /path: 'money\/accounts', element: <CustomerAccounts \/>/);
assert.match(router, /path: 'money\/transfers', element: <FundsHub \/>/);
assert.match(router, /path: 'money\/deposit', element: <FiatDepositPage \/>/);
assert.match(router, /path: 'money\/otc'/);
assert.match(router, /path: 'money\/payouts'/);
assert.doesNotMatch(router, /submissionDisabledReason="当前版本的 OTC/);
assert.match(router, /submissionDisabledReason="当前版本暂未开放客户法币转出申请/);
assert.match(router, /path: 'transactions', element: <CustomerActivity \/>/);
assert.match(router, /<Navigate to="\/portal\/home" replace \/>/);
assert.match(router, /<Navigate to="\/admin" replace \/>/);
assert.match(router, /path: 'crypto-wallet\/withdraw'/);
assert.match(router, /path: 'virtual-accounts'/);
assert.match(authRoutes, /export const adminAuthRoutes/);
assert.match(authRoutes, /export const customerAuthRoutes/);
assert.match(authRoutes, /path: 'customer\/register'/);
assert.match(authRoutes, /path: 'customer\/forgot-password'/);
assert.match(authRoutes, /path: 'customer\/reset-password'/);
assert.match(authRoutes, /path: 'customer\/verify-email'/);
assert.match(authRoutes, /const partnerAuthRoutes/);
assert.match(authLayout, /type AuthClassicContentMode = 'split' \| 'focused'/);
assert.match(authLayout, /mdUp && !focused && renderSection/);
assert.match(authLayout, /maxWidth: focused \? 1180 : 520/);
assert.match(
  registrationPage,
  /const individualStartsSumsub = form\.accountType === 'individual' && activeStep === 2/
);
assert.match(
  registrationPage,
  /const submitsApplication = individualStartsSumsub \|\| activeStep === steps\.length - 1/
);
assert.match(registrationPage, /auth\.registration\.actions\.start_sumsub/);
assert.match(registrationPage, /type === 'idCheck\.onReady'/);
assert.match(
  registrationPage,
  /useAuthClassicContentMode\(submittedReference \|\| activeStep > 0 \? 'focused' : 'split'\)/
);
assert.match(registrationPage, /maxWidth: 920/);
const registrationDetails = registrationPage.slice(
  registrationPage.indexOf('const renderDetails ='),
  registrationPage.indexOf('const kycItems =')
);
const registrationFieldOrder = [
  "countrySelect('residenceCountry'",
  'auth.registration.details.contact',
  'auth.registration.fields.email',
  'auth.registration.fields.phone',
  'auth.registration.details.security',
  'auth.registration.fields.password',
].map((marker) => registrationDetails.indexOf(marker));
assert.ok(
  registrationFieldOrder.every(
    (position, index) =>
      position >= 0 && (index === 0 || position > registrationFieldOrder[index - 1])
  ),
  'registration details must keep identity, contact, and sign-in security fields grouped'
);
assert.match(roleAccess, /admin: IS_ISOLATED_WALLET_DEPLOYMENT \? '\/admin'/);
assert.match(roleAccess, /customer: '\/portal\/home'/);
assert.match(roleAccess, /pathname === '\/portal\/virtual-accounts'/);
assert.match(roleAccess, /pathname === '\/portal\/money\/accounts'/);
assert.match(roleAccess, /pathname === '\/portal\/money\/transfers'/);
assert.match(roleAccess, /pathname === '\/portal\/money\/otc'/);
assert.match(roleAccess, /isCustomerFullPortalPath\(canonicalUrl\.pathname\)/);
assert.match(roleAccess, /!customerPathAllowed/);
assert.match(provider, /IS_NEOBANK_DEPLOYMENT \|\|/);
assert.doesNotMatch(provider, /getAccessAdminSession/);
assert.match(
  provider,
  /if \(window\.location\.pathname\.startsWith\('\/customer'\)\) return null;/
);
assert.match(provider, /error instanceof AuthApiError && error\.status === 401/);
assert.match(deploymentMode, /IS_FULL_ADMIN_WALLET_DEPLOYMENT/);
assert.match(deploymentMode, /IS_NEOBANK_DEPLOYMENT/);
for (const page of [adminPage, onboardingPage, financeWorkspace]) {
  assert.match(page, /const userId = 'usr_admin'/);
  assert.doesNotMatch(page, /本地演示身份|demoUsers|setUserId/);
}
assert.match(coreApi, /userId = 'usr_admin'/);
assert.doesNotMatch(coreApi, /提交人 Maker|复核人 Checker|出款操作员|demoUsers/);
assert.match(adminPage, /IS_NEOBANK_DEPLOYMENT/);
assert.match(adminPage, /neobankApi/);
assert.match(adminPage, /paths\.dashboard\.onboardingReview\(customer\.id\)/);
assert.doesNotMatch(adminPage, /\/admin\/customers\/\$\{customer\.id\}\/kyc/);
assert.doesNotMatch(adminPage, /\/admin\/customers\/\$\{customer\.id\}\/activate/);
assert.doesNotMatch(adminPage, /customerReadyForWallet\(customer\)/);
assert.doesNotMatch(adminPage, /创建 Cregis 钱包/);
assert.match(neobankCustomerHelper, /neobankApi<\{ data: NeobankCustomerRecord\[\] \}>/);
assert.match(onboardingPage, /loadNeobankCustomerRecords/);
assert.match(onboardingPage, /paths\.dashboard\.onboardingReview\(customer\.id\)/);
assert.doesNotMatch(onboardingPage, /\/admin\/customers\/\$\{customer\.id\}\/kyc/);
assert.match(kycReviewPage, /\/admin\/customers\/\$\{customer\.id\}\/kyc/);
assert.match(kycReviewPage, /reviewChecks\.every/);
assert.match(kycReviewPage, /note\.trim\(\)\.length >= 10/);
assert.match(customerManagementPage, /row\.kyc_status === 'approved'/);
assert.match(customerManagementPage, /customer\.kycStatus === 'APPROVED'/);
assert.match(coreApi, /SYSTEM_WALLET_PRODUCT_NAME = 'SSC钱包'/);
assert.match(customerDetailPage, /title=\{SYSTEM_WALLET_PRODUCT_NAME\}/);
assert.match(customerDetailPage, /title="VA 钱包"/);
assert.match(customerDetailPage, /title="数字货币钱包"/);
assert.match(customerDetailPage, /账面资产/);
assert.match(customerDetailPage, /data-testid="account-asset-rows"/);
assert.match(customerDetailPage, /supportedFiatCurrencies/);
assert.match(customerDetailPage, /法币转出/);
assert.match(customerDetailPage, /设置专属/);
assert.match(customerDetailPage, /配置默认/);
assert.match(customerDetailPage, /管理机构默认/);
assert.doesNotMatch(
  customerDetailPage,
  /funding-channels\?organizationId=\$\{encodeURIComponent\([\s\S]*?\)&type=VIRTUAL_ACCOUNT/
);
assert.doesNotMatch(onboardingPage, /virtual-account-requests/);
assert.match(dashboardPaths, /operations\/virtual-accounts/);
assert.match(dashboardRoutes, /path: 'virtual-accounts'/);
assert.match(dashboardRoutes, /path: 'virtual-accounts\/:id'/);
assert.match(dashboardNavigation, /navigation\.vaApplications/);
assert.match(dashboardNavigation, /navigation\.customerAccounts/);
assert.match(dashboardNavigation, /navigation\.fundProcessing/);
assert.match(dashboardNavigation, /navigation\.fxManagement/);
assert.match(dashboardNavigation, /navigation\.accountingQueries/);
assert.doesNotMatch(dashboardNavigation, /paths\.dashboard\.fundOperations\.balances/);
assert.doesNotMatch(dashboardNavigation, /navigation\.businessApprovals/);
assert.doesNotMatch(dashboardPaths, /approvals:/);
assert.match(dashboardRoutes, /path: 'approvals',[\s\S]*?\?status=SUBMITTED/);
assert.match(financeWorkspace, /useSearchParams/);
assert.match(financeWorkspace, /operationActionText/);
assert.doesNotMatch(financeWorkspace, /section === 'approvals'/);
assert.match(dashboardRoutes, /<CoreReconciliationPage \/>/);
assert.match(coreReconciliation, /buildCoreReconciliationSnapshot/);
assert.match(coreReconciliation, /\/operations\?organizationId=/);
assert.match(coreReconciliation, /\/ledger\?organizationId=/);
assert.doesNotMatch(coreReconciliation, /\/api\/browser\/v1/);
assert.doesNotMatch(dashboardRoutes, /<OperationsPage section="audit" \/>/);
assert.match(dashboardRoutes, /path: 'audit-logs',[\s\S]*?paths\.dashboard\.notFound/);
assert.match(dashboardRoutes, /path: 'balances',[\s\S]*?paths\.dashboard\.accounts/);
assert.match(vaRequestManagement, /\/virtual-account-requests\?organizationId=/);
assert.match(vaRequestManagement, /virtualAccountDetails\(request\.id\)/);
assert.match(vaRequestReview, /\/virtual-account-requests\/\$\{request\.id\}\/approve/);
assert.match(vaRequestReview, /\/virtual-account-requests\/\$\{request\.id\}\/reject/);
assert.match(vaRequestReview, /客户所选银行与币种/);
assert.doesNotMatch(vaRequestReview, /setChannelId|setCurrency|setPurpose/);
assert.match(customerAdmin, /approveCustomerKYCAutomationSQL/);
assert.match(customerAdmin, /operations_status='active'/);
assert.match(customerAdmin, /automaticWalletIdempotency\(id\)/);
assert.match(customerAdmin, /automaticWalletAlias\(id\)/);
assert.match(customerAdmin, /provisionCregisWallet/);
assert.match(
  portalCustomerContext,
  /coreApi<CustomerHomeBootstrap>\('\/customer\/home',[\s\S]*?onTransientRetry/
);
assert.doesNotMatch(portalCustomerContext, /neobankApi<[\s\S]*?>\('\/customer\/profile'\)/);
assert.match(portalCustomerContext, /\.slice\(0, 5\)/);
for (const label of ['总览', '钱包', '转入转出', 'OTC', '交易记录']) {
  assert.match(portalLayout, new RegExp(`\\['${label}',`));
}
assert.doesNotMatch(portalLayout, /\['VA 账户', '\/portal\/virtual-accounts'/);
assert.doesNotMatch(portalLayout, /\['USDT 钱包', '\/portal\/crypto-wallet'/);
assert.match(portalLayout, /customerMobileNavPaths/);
assert.match(
  customerCryptoWallet,
  /neobankApi<\{ data: CustomerWalletRow\[\] \}>\('\/customer\/wallets'\)/
);
assert.match(customerCryptoWallet, /neobankApi<CustomerHistory>\('\/customer\/history'\)/);

assert.match(worker, /proxyAPI\(request, env, 'application-session-edge'\)/);
assert.match(worker, /proxyCoreAPI\(request, env\)/);
assert.match(worker, /loadApplicationSession\(request, env, requestedRole\)/);
assert.match(worker, /`\/api\/auth\/\$\{expectedRole\}\/me`/);
assert.match(worker, /session_role_required/);
assert.match(coreApi, /X-Neobank-Session-Role/);
assert.match(worker, /customerHomeAPI\(request, env\)/);
assert.match(worker, /internalGetRequest\(request, '\/api\/v1\/customer\/profile'\)/);
assert.match(worker, /customerId=\$\{encodedCustomerId\}&limit=5/);
assert.match(worker, /customerCoreRouteAllowed\(incoming, request\.method, userId/);
assert.match(worker, /type === 'VIRTUAL_ACCOUNT'/);
assert.match(worker, /type === 'FIAT_INBOUND'/);
assert.match(worker, /active'\) === 'true'/);
assert.match(worker, /customers\/\$\{customerId\}\/virtual-account-requests/);
assert.match(worker, /if \(method !== 'GET'\) return false/);
assert.match(worker, /api\/core\/accounts\/summary/);
assert.match(worker, /api\/core\/operations/);
assert.match(worker, /api\/core\/operations\/quote/);
assert.match(worker, /quote_not_confirmable|operations.*confirm/s);
assert.match(worker, /api\/core\/crypto-wallets\/transfers/);
assert.match(worker, /redactCustomerCorePayload/);
assert.match(worker, /invalid_csrf_token/);
assert.match(worker, /incoming\.pathname === '\/api\/core\/rates\/from-market'/);
assert.match(worker, /fetchLiveMarketQuote/);
assert.match(worker, /role === 'customer' \? '\/api\/v1\/customer\/market-rate'/);
assert.match(worker, /quote\.provider !== 'fastforex'/);
assert.match(worker, /referenceRate: quote\.rate/);
assert.match(worker, /incoming\.pathname === '\/api\/core\/operations'/);
assert.match(worker, /marketRate: quote\.rate/);
assert.match(worker, /incoming\.pathname === '\/api\/core\/rates'/);
assert.match(worker, /customerRate: customerRate\.toFixed/);
assert.match(worker, /incoming\.pathname === '\/api\/core\/accounts\/summary'/);
assert.match(worker, /fetchLiveMarketQuote\(request, env, role, item\.currency, 'USD'\)/);
assert.doesNotMatch(accountsService, /rateVersion\./);
assert.match(worker, /replace\(\/\^\\\/api\\\/core/);
assert.doesNotMatch(worker, /handleAuthRequest/);
assert.doesNotMatch(worker, /authorizeBrowserRequest/);
assert.doesNotMatch(worker, /\.DB\b/);
assert.doesNotMatch(worker, /verifyAccess/);
assert.match(worker, /hasValidMutationOrigin\(request\)/);
assert.match(renderConfig, /key: DATABASE_BACKEND\s+value: postgres/);
assert.match(renderConfig, /name: neobank-core/);
assert.match(renderConfig, /rootDir: server/);
assert.match(coreRenderService, /plan: starter/);
assert.match(coreRenderService, /healthCheckPath: \/api\/v1\/health/);
assert.match(renderConfig, /key: CORE_EDGE_SHARED_SECRET\s+sync: false/);
assert.match(renderConfig, /key: CORE_EDGE_AUTH_REQUIRED\s+value: ['"]true['"]/);
assert.match(renderConfig, /key: NEOBANK_SOURCE_TENANT_ID\s+value: neobank/);
assert.match(renderConfig, /name: neobank-financial-accounting-worker/);
assert.match(renderConfig, /startCommand: npm run start:financial-accounting-worker/);
assert.match(renderConfig, /key: WITHDRAWAL_ACCOUNTING_ENABLED\s+value: ['"]false['"]/);
assert.doesNotMatch(coreRenderService, /key: CUSTOMER_PASSWORD_RESET_SECRET/);
assert.match(emailRenderService, /key: CUSTOMER_PASSWORD_RESET_SECRET\s+sync: false/);
assert.doesNotMatch(renderConfig, /D1_GATEWAY_/);
assert.match(goMain, /databaseBackend != "postgres"/);
assert.doesNotMatch(goMain, /case "d1"/);
assert.match(coreMain, /edgeAuthMiddleware/);
assert.match(coreMain, /CORE_EDGE_AUTH_REQUIRED/);
assert.match(coreMain, /bodyParser: false/);
assert.match(coreMain, /expressJson\(\{ limit: '128kb', verify: captureRawBody \}\)/);
assert.ok(
  coreMain.indexOf('app.use(expressJson') < coreMain.indexOf('app.use(edgeAuthMiddleware'),
  'Core JSON body parser must run before edge signature verification'
);
assert.match(coreEdgeAuth, /timingSafeEqual/);
assert.match(coreEdgeAuth, /request\.headers\['x-user-id'\] = options\.adminUserId/);
assert.match(coreEdgeAuth, /x-authenticated-customer-id/);
assert.match(customerSync, /FROM customers c/);
assert.match(customerSync, /db\.customer\.upsert/);
assert.match(depositAccountingWorker, /TransactionIsolationLevel\.Serializable/);
assert.match(depositAccountingWorker, /status='posted'/);
assert.match(depositAccountingWorker, /core_deposit_duplicate/);
assert.match(depositAccountingMigration, /do not backfill existing deposits/i);
assert.match(
  depositAccountingMigration,
  /status IN \('held', 'pending', 'processing', 'posted', 'exception'\)/
);
assert.match(cregisHandlers, /INSERT OR IGNORE INTO cregis_deposit_accounting/);
assert.match(cregisHandlers, /a\.status='posted'/);
assert.match(withdrawalAccountingWorker, /TransactionIsolationLevel\.Serializable/);
assert.match(withdrawalAccountingWorker, /status='reserved'/);
assert.match(withdrawalAccountingWorker, /status='settled'/);
assert.match(withdrawalAccountingWorker, /core_withdrawal_duplicate/);
assert.match(withdrawalAccountingMigration, /do not enqueue historical withdrawals/i);
assert.match(withdrawalAccountingMigration, /status = 'settled'/);
assert.match(cregisHandlers, /withdrawal_accounting_not_enabled/);
assert.match(cregisHandlers, /THEN 'pending_settlement'/);
assert.match(coreReconciliation, /ledger\/reconciliation\/usdt/);
assert.match(virtualAccountsPage, /选择银行并查看其支持币种/);
assert.match(virtualAccountsPage, /supportedCurrencies/);

console.log('Neobank full-admin-wallet profile checks passed.');
