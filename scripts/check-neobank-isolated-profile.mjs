import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

const [packageSource, router, authRoutes, provider, roleAccess, deploymentMode, adminPage, worker] =
  await Promise.all([
    read('package.json'),
    read('src/routes/sections/index.tsx'),
    read('src/routes/sections/auth.tsx'),
    read('src/auth/context/jwt/auth-provider.tsx'),
    read('src/auth/role-access.ts'),
    read('src/config/deployment-mode.ts'),
    read('src/pages/dashboard/crypto-operations.tsx'),
    read('worker-web/index.ts'),
  ]);

const packageJson = JSON.parse(packageSource);
const scripts = packageJson.scripts || {};

assert.match(
  scripts['neobank:build'] || '',
  /REACT_APP_NEOBANK_DEPLOYMENT_MODE=isolated-wallet/,
  'neobank:build must compile the isolated-wallet profile'
);
for (const name of ['neobank:deploy:prepared', 'neobank:deploy:dry-run:prepared']) {
  assert.match(
    scripts[name] || '',
    /--config wrangler\.neobank\.jsonc/,
    `${name} must name wrangler.neobank.jsonc explicitly`
  );
  assert.doesNotMatch(scripts[name], /npm run cf:/, `${name} must not call the VA API release`);
}

assert.match(
  router,
  /IS_ISOLATED_WALLET_DEPLOYMENT \? isolatedWalletRoutes : fullApplicationRoutes/
);
assert.match(router, /\.\.\.customerAuthRoutes/);
assert.match(router, /\.\.\.authRoutes/);
assert.match(router, /\.\.\.dashboardRoutes/);
assert.match(router, /path: '\/admin'/);
assert.match(router, /path: '\/admin\/neobank-crypto'/);
assert.match(router, /path: 'home', element: <CryptoWalletPage \/>/);
assert.match(router, /<Navigate to="\/portal\/home" replace \/>/);
assert.match(router, /<Navigate to="\/admin" replace \/>/);
assert.match(router, /path: 'crypto-wallet\/withdraw'/);
assert.match(authRoutes, /export const customerAuthRoutes/);
assert.match(authRoutes, /path: 'customer\/register'/);
assert.match(authRoutes, /const partnerAuthRoutes/);
assert.match(roleAccess, /admin: IS_ISOLATED_WALLET_DEPLOYMENT \? '\/admin'/);
assert.match(roleAccess, /customer: '\/portal\/home'/);
assert.match(deploymentMode, /pathname === '\/admin'/);

assert.match(provider, /IS_ISOLATED_WALLET_DEPLOYMENT \|\|/);
assert.match(provider, /getAccessAdminSession/);
assert.match(
  provider,
  /if \(window\.location\.pathname\.startsWith\('\/customer'\)\) return null;/
);
assert.match(adminPage, /process\.env\.NODE_ENV === 'development'/);
assert.match(adminPage, /!IS_ISOLATED_WALLET_DEPLOYMENT/);
assert.match(adminPage, /\/admin\/customers\/\$\{customer\.id\}\/kyc/);
assert.match(adminPage, /\/admin\/customers\/\$\{customer\.id\}\/activate/);
assert.match(adminPage, /customerReadyForWallet\(customer\)/);

const verifyIndex = worker.indexOf('const claims = await verifyAccess(request, env)');
const allowlistIndex = worker.indexOf("if (!claims || !adminAllowed(claims.email || '', env))");
const sessionIndex = worker.indexOf('return accessAdminSession(claims)');
assert.ok(verifyIndex >= 0, 'Access JWT verification must run in the request handler');
assert.ok(allowlistIndex > verifyIndex, 'admin allowlist must run after JWT verification');
assert.ok(
  sessionIndex > allowlistIndex,
  'admin session must be returned only after allowlist validation'
);
assert.match(worker, /claims\.nbf && claims\.nbf > now \+ 60/);
assert.match(worker, /hasValidMutationOrigin\(request\)/);

console.log('Neobank isolated-wallet profile checks passed.');
