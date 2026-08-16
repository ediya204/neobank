import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

const [
  packageSource,
  neobankWrangler,
  gatewayWrangler,
  router,
  authRoutes,
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
  customerSync,
] = await Promise.all([
  read('package.json'),
  read('wrangler.neobank.jsonc'),
  read('wrangler.gateway.jsonc'),
  read('src/routes/sections/index.tsx'),
  read('src/routes/sections/auth.tsx'),
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
  read('server/src/customers/neobank-customer-sync.ts'),
]);

const packageJson = JSON.parse(packageSource);
const scripts = packageJson.scripts || {};

assert.match(neobankWrangler, /"name": "neobank-web"/);
assert.match(neobankWrangler, /"pattern": "portal\.sscdigitalbank\.com"/);
assert.doesNotMatch(neobankWrangler, /"d1_databases"/);
assert.doesNotMatch(neobankWrangler, /"binding": "DB"/);
assert.match(neobankWrangler, /"ADMIN_AUTH_RATE_LIMITER"/);
assert.match(neobankWrangler, /"CORE_API_BASE_URL"/);
assert.match(neobankWrangler, /"CORE_EDGE_SHARED_SECRET"/);
assert.doesNotMatch(neobankWrangler, /CF_ACCESS_AUD/);
assert.match(gatewayWrangler, /"name": "neobank-d1-gateway"/);
assert.match(gatewayWrangler, /"database_name": "neobank-core-v1"/);
assert.match(gatewayWrangler, /"database_id": "c6127eb2-22b7-4477-bafb-e9e506dc058a"/);

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
assert.match(router, /path: 'home', element: <CryptoWalletPage \/>/);
assert.match(router, /<Navigate to="\/portal\/home" replace \/>/);
assert.match(router, /<Navigate to="\/admin" replace \/>/);
assert.match(router, /path: 'crypto-wallet\/withdraw'/);
assert.match(authRoutes, /export const adminAuthRoutes/);
assert.match(authRoutes, /export const customerAuthRoutes/);
assert.match(authRoutes, /path: 'customer\/register'/);
assert.match(authRoutes, /const partnerAuthRoutes/);
assert.match(roleAccess, /admin: IS_ISOLATED_WALLET_DEPLOYMENT \? '\/admin'/);
assert.match(roleAccess, /customer: '\/portal\/home'/);
assert.match(provider, /IS_NEOBANK_DEPLOYMENT \|\|/);
assert.doesNotMatch(provider, /getAccessAdminSession/);
assert.match(
  provider,
  /if \(window\.location\.pathname\.startsWith\('\/customer'\)\) return null;/
);
assert.match(deploymentMode, /IS_FULL_ADMIN_WALLET_DEPLOYMENT/);
assert.match(deploymentMode, /IS_NEOBANK_DEPLOYMENT/);
assert.match(adminPage, /process\.env\.NODE_ENV === 'development'/);
assert.match(adminPage, /IS_NEOBANK_DEPLOYMENT/);
assert.match(adminPage, /neobankApi/);
assert.match(adminPage, /\/admin\/customers\/\$\{customer\.id\}\/kyc/);
assert.match(adminPage, /\/admin\/customers\/\$\{customer\.id\}\/activate/);
assert.match(adminPage, /customerReadyForWallet\(customer\)/);
assert.match(onboardingPage, /neobankApi<\{ data: NeobankCustomer\[\] \}>/);
assert.match(onboardingPage, /decision: decision\.toLowerCase\(\)/);
assert.match(onboardingPage, /\/admin\/customers\/\$\{customer\.id\}\/activate/);

assert.match(worker, /proxyAPI\(request, env, 'application-session-edge'\)/);
assert.match(worker, /proxyCoreAPI\(request, env\)/);
assert.match(worker, /loadAdminSession\(request, env\)/);
assert.match(worker, /invalid_csrf_token/);
assert.match(worker, /replace\(\/\^\\\/api\\\/core/);
assert.doesNotMatch(worker, /handleAuthRequest/);
assert.doesNotMatch(worker, /authorizeBrowserRequest/);
assert.doesNotMatch(worker, /\.DB\b/);
assert.doesNotMatch(worker, /verifyAccess/);
assert.match(worker, /hasValidMutationOrigin\(request\)/);
assert.match(renderConfig, /key: DATABASE_BACKEND\s+value: postgres/);
assert.match(renderConfig, /name: neobank-core/);
assert.match(renderConfig, /rootDir: server/);
assert.match(renderConfig, /key: CORE_EDGE_SHARED_SECRET\s+sync: false/);
assert.match(renderConfig, /key: CORE_EDGE_AUTH_REQUIRED\s+value: "true"/);
assert.match(renderConfig, /key: NEOBANK_SOURCE_TENANT_ID\s+value: neobank/);
assert.doesNotMatch(renderConfig, /D1_GATEWAY_/);
assert.match(goMain, /databaseBackend != "postgres"/);
assert.doesNotMatch(goMain, /case "d1"/);
assert.match(coreMain, /edgeAuthMiddleware/);
assert.match(coreMain, /CORE_EDGE_AUTH_REQUIRED/);
assert.match(coreMain, /rawBody: true/);
assert.match(coreEdgeAuth, /timingSafeEqual/);
assert.match(coreEdgeAuth, /request\.headers\['x-user-id'\] = options\.adminUserId/);
assert.match(customerSync, /FROM customers c/);
assert.match(customerSync, /db\.customer\.upsert/);

console.log('Neobank full-admin-wallet profile checks passed.');
