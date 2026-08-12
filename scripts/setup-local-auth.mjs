import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const varsPath = path.join(root, '.dev.vars');
const outputDirectory = path.join(root, '.local-auth');
const setupLinkPath = path.join(outputDirectory, 'admin-setup-url.txt');
const partnerSetupLinkPath = path.join(outputDirectory, 'partner-setup-url.txt');
const localOrigin = 'http://127.0.0.1:8787';
const localAdminEmail = 'local.admin@localhost.test';
const localPartnerEmail = 'local.partner@localhost.test';

function randomSecret(size = 48) {
  return randomBytes(size).toString('base64url');
}

function parseVars(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values.set(match[1], match[2]);
  }
  return values;
}

async function readVarsSource() {
  try {
    return await readFile(varsPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function prepare() {
  const original = await readVarsSource();
  const values = parseVars(original);
  const required = {
    AUTH_ADMIN_EMAIL: localAdminEmail,
    AUTH_PARTNER_EMAIL: localPartnerEmail,
    API_CREDENTIAL_LOCAL_DEMO: 'true',
    AUTH_BOOTSTRAP_SECRET: randomSecret(),
    AUTH_TOTP_ENCRYPTION_KEY: randomSecret(32),
    AUTH_PASSWORD_PEPPER: randomSecret(),
    AUTH_RECOVERY_CODE_PEPPER: randomSecret(),
    AUTH_SESSION_SECRET: randomSecret(),
    PARTNER_WEBHOOK_SIGNING_SECRET: randomSecret(),
  };
  const additions = [];

  for (const [name, generated] of Object.entries(required)) {
    if (values.has(name)) {
      if (
        (name === 'AUTH_ADMIN_EMAIL' && values.get(name) !== localAdminEmail) ||
        (name === 'AUTH_PARTNER_EMAIL' && values.get(name) !== localPartnerEmail)
      ) {
        throw new Error(
          `.dev.vars already defines ${name}. Refusing to replace an existing identity automatically.`
        );
      }
      continue;
    }
    additions.push(`${name}=${generated}`);
  }

  if (additions.length) {
    const separator = original && !original.endsWith('\n') ? '\n' : '';
    const heading = original ? '# Local Admin development realm\n' : '';
    await writeFile(
      varsPath,
      `${original}${separator}${heading}${additions.join('\n')}\n`,
      { mode: 0o600 }
    );
  }
  await chmod(varsPath, 0o600);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  console.log(
    additions.length
      ? `Prepared ${additions.length} missing local-only authentication variables.`
      : 'Local-only authentication variables are already prepared.'
  );
  console.log('No secret values were printed. Restart the local Worker before issuing a setup link.');
}

async function requestSetupLink(role) {
  const values = parseVars(await readVarsSource());
  const bootstrapSecret = values.get('AUTH_BOOTSTRAP_SECRET');
  if (!bootstrapSecret) {
    throw new Error('Run `npm run local:auth:prepare` first.');
  }

  const isPartner = role === 'partner';
  const email = isPartner ? localPartnerEmail : localAdminEmail;
  const setupRoute = isPartner ? '/portal/setup' : '/admin/setup';
  const outputPath = isPartner ? partnerSetupLinkPath : setupLinkPath;

  async function issue(purpose) {
    const response = await fetch(`${localOrigin}/api/auth/setup-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrapSecret}`,
        'Content-Type': 'application/json',
        Origin: localOrigin,
      },
      body: JSON.stringify({
        email,
        role,
        purpose,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  let result = await issue('credential_reset');
  if (
    result.response.status === 409 &&
    result.payload?.error?.code === 'credential_reset_not_available'
  ) {
    result = await issue('initial_setup');
  }
  if (!result.response.ok) {
    throw new Error(
      `Setup-token request failed (${result.response.status}): ${
        result.payload?.error?.code || 'unknown_error'
      }`
    );
  }

  const token = result.payload?.data?.setup_token;
  if (!token) throw new Error('Setup-token response did not contain a token.');
  const url = `${localOrigin}${setupRoute}#setup_token=${encodeURIComponent(token)}`;
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  await writeFile(outputPath, `${url}\n`, { mode: 0o600 });
  console.log(`Local ${isPartner ? 'Partner' : 'Admin'} setup link written to ${outputPath}`);
  console.log('The link expires in 30 minutes and is intentionally excluded from Git.');
}

const command = process.argv[2];
if (command === 'prepare') {
  await prepare();
} else if (command === 'issue-link') {
  await requestSetupLink('admin');
} else if (command === 'issue-partner-link') {
  await requestSetupLink('partner');
} else {
  throw new Error(
    'Usage: node scripts/setup-local-auth.mjs <prepare|issue-link|issue-partner-link>'
  );
}
