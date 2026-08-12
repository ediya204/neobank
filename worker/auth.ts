import {
  beginPortalInvitationEnrollment,
  portalInvitationEnrollmentStatements,
  resolvePortalTeamPrincipal,
} from './portal-team';

export type AuthRole = 'admin' | 'partner';

export type AuthPrincipal = {
  userId: string;
  email: string;
  role: AuthRole;
  sessionId: string | null;
  expiresAt: string | null;
  via: 'session';
};

type RateLimiterBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type AuthEnv = Env & {
  AUTH_BOOTSTRAP_SECRET?: string;
  AUTH_TOTP_ENCRYPTION_KEY?: string;
  AUTH_PASSWORD_PEPPER?: string;
  AUTH_RECOVERY_CODE_PEPPER?: string;
  AUTH_SESSION_SECRET?: string;
  AUTH_ADMIN_EMAIL?: string;
  AUTH_PARTNER_EMAIL?: string;
  AUTH_LOCAL_BYPASS?: string;
  AUTH_RATE_LIMITER: RateLimiterBinding;
};

type AuthUserRow = {
  id: string;
  email: string;
  role: AuthRole;
  status: 'active' | 'disabled';
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
  totp_secret_ciphertext: string | null;
  totp_secret_iv: string | null;
  totp_enabled: number;
  last_totp_counter: number;
  recovery_codes_json: string;
  failed_password_attempts: number;
  locked_until: string | null;
  setup_completed_at: string | null;
  password_changed_at: string | null;
};

type SetupTokenRow = {
  id: string;
  user_id: string;
  email: string;
  role: AuthRole;
  expires_at: string;
  used_at: string | null;
  setup_completed_at: string | null;
};

type EnrollmentRow = {
  id: string;
  user_id: string;
  email: string;
  role: AuthRole;
  expires_at: string;
  verified_at: string | null;
  secret_ciphertext: string | null;
  secret_iv: string | null;
};

type LoginChallengeRow = AuthUserRow & {
  challenge_id: string;
  challenge_credential_version: string | null;
  challenge_expires_at: string;
  challenge_attempts: number;
  challenge_consumed_at: string | null;
  challenge_ip_hash: string;
  challenge_user_agent_hash: string;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  role: AuthRole;
  user_status: 'active' | 'disabled';
  expires_at: string;
  idle_expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

type RequestContext = {
  ipHash: string;
  userAgentHash: string;
};

type RecoveryCodeRecord = {
  salt: string;
  hash: string;
  used_at?: string;
};

const SESSION_COOKIE = '__Host-va_session';
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_MIN_LENGTH = 14;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_PEPPER_DOMAIN = 'fidere-va-auth/password/v1\u0000';
const DUMMY_PASSWORD_SALT_DOMAIN = 'fidere-va-auth/password/dummy-salt/v1';
const DUMMY_PASSWORD_HASH_DOMAIN = 'fidere-va-auth/password/dummy-hash/v1';
const CREDENTIAL_VERSION_DOMAIN = 'fidere-va-auth/credential-version/v1\u0000';
const LOGIN_CHALLENGE_SECONDS = 5 * 60;
const ENROLLMENT_SECONDS = 15 * 60;
const SETUP_TOKEN_SECONDS = 30 * 60;
const SESSION_SECONDS = 8 * 60 * 60;
const SESSION_IDLE_SECONDS = 60 * 60;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const MAX_CHALLENGE_ATTEMPTS = 8;
const MAX_FAILED_PASSWORD_ATTEMPTS = 5;
const PASSWORD_LOCK_SECONDS = 15 * 60;
const AUTH_JSON_MAX_BYTES = 16_384;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function authJson(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function authError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: HeadersInit
) {
  return authJson(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
    headers
  );
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isEmail(value: string) {
  return (
    value.length >= 3 &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readAuthJson(
  request: Request
): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > AUTH_JSON_MAX_BYTES) {
    return authError(413, 'payload_too_large', '请求内容不能超过 16 KB');
  }
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > AUTH_JSON_MAX_BYTES) {
          await reader.cancel();
          return authError(413, 'payload_too_large', '请求内容不能超过 16 KB');
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = textDecoder.decode(bytes);
    const value: unknown = JSON.parse(text);
    return isRecord(value)
      ? value
      : authError(400, 'invalid_json', '请求内容必须是 JSON 对象');
  } catch {
    return authError(400, 'invalid_json', '无法解析 JSON 请求内容');
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function sha256Bytes(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function sha256(value: string | Uint8Array) {
  return bytesToBase64Url(await sha256Bytes(value));
}

async function hmacBytes(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(value)
  );
  return new Uint8Array(signature);
}

async function hmac(secret: string, value: string) {
  return bytesToBase64Url(await hmacBytes(secret, value));
}

async function timingSafeStringEqual(left: string, right: string) {
  const leftHash = await sha256Bytes(left);
  const rightHash = await sha256Bytes(right);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

function nowIso() {
  return new Date().toISOString();
}

function futureIso(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function minIso(left: string, right: string) {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function hasExpired(value: string | null) {
  return !value || Date.parse(value) <= Date.now();
}

function configuredEmails(env: AuthEnv, role: AuthRole) {
  const configured =
    role === 'admin' ? env.AUTH_ADMIN_EMAIL : env.AUTH_PARTNER_EMAIL;
  return (configured || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

type AuthConfigurationRequirements = {
  password?: boolean;
  totp?: boolean;
};

function missingAuthConfiguration(
  env: AuthEnv,
  requirements: AuthConfigurationRequirements = {}
) {
  const missing: string[] = [];
  if (!env.AUTH_SESSION_SECRET) missing.push('AUTH_SESSION_SECRET');
  if (!env.AUTH_RECOVERY_CODE_PEPPER) {
    missing.push('AUTH_RECOVERY_CODE_PEPPER');
  }
  if (requirements.password && !env.AUTH_PASSWORD_PEPPER) {
    missing.push('AUTH_PASSWORD_PEPPER');
  }
  if (requirements.totp && !env.AUTH_TOTP_ENCRYPTION_KEY) {
    missing.push('AUTH_TOTP_ENCRYPTION_KEY');
  }
  return missing;
}

function configurationError(missing: string[]) {
  console.error(
    JSON.stringify({
      event: 'auth_configuration_missing',
      bindings: missing,
    })
  );
  return authError(
    503,
    'auth_unavailable',
    '身份验证服务暂时不可用，请联系管理员'
  );
}

async function requestContext(request: Request): Promise<RequestContext> {
  const ip =
    request.headers.get('CF-Connecting-IP')?.trim() ||
    request.headers.get('X-Real-IP')?.trim() ||
    'local';
  const userAgent = request.headers.get('User-Agent')?.slice(0, 512) || 'unknown';
  return {
    ipHash: await sha256(`ip:${ip}`),
    userAgentHash: await sha256(`ua:${userAgent}`),
  };
}

async function coarseAuthRateLimit(
  env: AuthEnv,
  context: RequestContext
): Promise<Response | null> {
  const result = await env.AUTH_RATE_LIMITER.limit({
    key: `auth:${context.ipHash.slice(0, 32)}`,
  });
  return result.success
    ? null
    : authError(
        429,
        'auth_rate_limited',
        '请求过于频繁，请稍后重试',
        undefined,
        { 'retry-after': '60' }
      );
}

async function enforceD1RateLimit(
  env: AuthEnv,
  rawKey: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number
): Promise<Response | null> {
  const keyHash = await sha256(`rate:${rawKey}`);
  const now = nowIso();
  const windowCutoff = new Date(
    Date.now() - windowSeconds * 1000
  ).toISOString();
  const nextBlockedUntil = futureIso(blockSeconds);
  const current = await env.DB.prepare(
    `INSERT INTO auth_rate_limits
       (key_hash, window_started_at, attempts, blocked_until, updated_at)
     VALUES (?, ?, 1, NULL, ?)
     ON CONFLICT(key_hash) DO UPDATE SET
       window_started_at=CASE
         WHEN auth_rate_limits.window_started_at<=?
           THEN excluded.window_started_at
         ELSE auth_rate_limits.window_started_at
       END,
       attempts=CASE
         WHEN auth_rate_limits.window_started_at<=? THEN 1
         ELSE auth_rate_limits.attempts+1
       END,
       blocked_until=CASE
         WHEN auth_rate_limits.blocked_until IS NOT NULL
              AND auth_rate_limits.blocked_until>?
           THEN auth_rate_limits.blocked_until
         WHEN (
           CASE
             WHEN auth_rate_limits.window_started_at<=? THEN 1
             ELSE auth_rate_limits.attempts+1
           END
         )>?
           THEN ?
         ELSE NULL
       END,
       updated_at=excluded.updated_at
     RETURNING attempts, blocked_until`
  )
    .bind(
      keyHash,
      now,
      now,
      windowCutoff,
      windowCutoff,
      now,
      windowCutoff,
      limit,
      nextBlockedUntil
    )
    .first<{ attempts: number; blocked_until: string | null }>();
  const blockedUntil = current?.blocked_until || null;
  const retryAfter = blockedUntil
    ? Math.max(1, Math.ceil((Date.parse(blockedUntil) - Date.now()) / 1000))
    : blockSeconds;
  return blockedUntil
    ? authError(
        429,
        'auth_rate_limited',
        '请求过于频繁，请稍后重试',
        undefined,
        { 'retry-after': String(retryAfter) }
      )
    : null;
}

async function auditAuth(
  env: AuthEnv,
  context: RequestContext,
  action: string,
  result: 'success' | 'failure' | 'blocked',
  options: {
    userId?: string | null;
    email?: string;
    metadata?: Record<string, unknown>;
  } = {}
) {
  try {
    await env.DB.prepare(
      `INSERT INTO auth_audit_events
        (id, user_id, email_hash, action, result, ip_hash, user_agent_hash,
         metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        randomId('aue'),
        options.userId || null,
        options.email ? await sha256(`email:${normalizeEmail(options.email)}`) : null,
        action,
        result,
        context.ipHash,
        context.userAgentHash,
        JSON.stringify(options.metadata || {}),
        nowIso()
      )
      .run();
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: 'auth_audit_write_failed',
        action,
        message: caught instanceof Error ? caught.message : 'unknown error',
      })
    );
  }
}

async function derivePassword(
  env: AuthEnv,
  password: string,
  salt: Uint8Array
) {
  if (!env.AUTH_PASSWORD_PEPPER) {
    throw new Error('AUTH_PASSWORD_PEPPER is missing');
  }
  const pepperedPassword = await hmacBytes(
    env.AUTH_PASSWORD_PEPPER,
    `${PASSWORD_PEPPER_DOMAIN}${password}`
  );
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    pepperedPassword,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PASSWORD_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );
  return new Uint8Array(bits);
}

async function hashPassword(env: AuthEnv, password: string) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePassword(env, password, salt);
  return {
    hash: bytesToBase64Url(derived),
    salt: bytesToBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  };
}

function storedPasswordMaterial(user: AuthUserRow | null) {
  if (
    !user?.password_hash ||
    !user.password_salt ||
    user.password_iterations !== PASSWORD_ITERATIONS
  ) {
    return null;
  }
  try {
    const salt = base64UrlToBytes(user.password_salt);
    const expected = base64UrlToBytes(user.password_hash);
    return salt.byteLength === 16 && expected.byteLength === 32
      ? { salt, expected }
      : null;
  } catch {
    return null;
  }
}

async function verifyPassword(
  env: AuthEnv,
  password: string,
  user: AuthUserRow | null
) {
  const stored = storedPasswordMaterial(user);
  const dummySalt = await sha256Bytes(DUMMY_PASSWORD_SALT_DOMAIN);
  const salt = stored?.salt || dummySalt.subarray(0, 16);
  const expected =
    stored?.expected || (await sha256Bytes(DUMMY_PASSWORD_HASH_DOMAIN));
  const actual = await derivePassword(env, password, salt);
  const matches = crypto.subtle.timingSafeEqual(actual, expected);
  return Boolean(stored) && matches;
}

function passwordValidationError(password: unknown): Response | null {
  if (typeof password !== 'string') {
    return authError(422, 'validation_error', 'password 必须是字符串');
  }
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return authError(
      422,
      'validation_error',
      `密码长度必须为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符`
    );
  }
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return authError(
      422,
      'validation_error',
      '密码必须同时包含大写字母、小写字母、数字和符号'
    );
  }
  return null;
}

function decodeTotpEncryptionKey(value: string) {
  const bytes = base64UrlToBytes(value);
  if (bytes.byteLength !== 32) {
    throw new Error('AUTH_TOTP_ENCRYPTION_KEY must be a base64url 32-byte key');
  }
  return bytes;
}

async function importTotpEncryptionKey(env: AuthEnv) {
  if (!env.AUTH_TOTP_ENCRYPTION_KEY) {
    throw new Error('AUTH_TOTP_ENCRYPTION_KEY is missing');
  }
  return crypto.subtle.importKey(
    'raw',
    decodeTotpEncryptionKey(env.AUTH_TOTP_ENCRYPTION_KEY),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptTotpSecret(
  env: AuthEnv,
  userId: string,
  secret: Uint8Array
) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importTotpEncryptionKey(env);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: textEncoder.encode(`va-auth-totp:${userId}`),
      tagLength: 128,
    },
    key,
    secret
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptTotpSecret(
  env: AuthEnv,
  userId: string,
  ciphertext: string,
  iv: string
) {
  const key = await importTotpEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(iv),
      additionalData: textEncoder.encode(`va-auth-totp:${userId}`),
      tagLength: 128,
    },
    key,
    base64UrlToBytes(ciphertext)
  );
  return new Uint8Array(plaintext);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

async function totpAt(secret: Uint8Array, counter: number) {
  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, counterBytes)
  );
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

async function verifyTotp(
  secret: Uint8Array,
  code: unknown
): Promise<number | null> {
  if (
    typeof code !== 'string' ||
    !new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)
  ) {
    return null;
  }
  const currentCounter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    if (await timingSafeStringEqual(await totpAt(secret, currentCounter + offset), code)) {
      return currentCounter + offset;
    }
  }
  return null;
}

function recoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const characters = [...bytes].map(
    (byte) => alphabet[byte % alphabet.length]
  );
  return `${characters.slice(0, 4).join('')}-${characters
    .slice(4, 8)
    .join('')}-${characters.slice(8).join('')}`;
}

async function createRecoveryCodes(env: AuthEnv) {
  if (!env.AUTH_RECOVERY_CODE_PEPPER) {
    throw new Error('AUTH_RECOVERY_CODE_PEPPER is missing');
  }
  const codes = Array.from({ length: 10 }, recoveryCode);
  const records: RecoveryCodeRecord[] = [];
  for (const code of codes) {
    const salt = randomToken(16);
    records.push({
      salt,
      hash: await hmac(
        env.AUTH_RECOVERY_CODE_PEPPER,
        `recovery:${salt}:${code.replace(/-/g, '').toUpperCase()}`
      ),
    });
  }
  return { codes, records };
}

async function consumeRecoveryCode(
  env: AuthEnv,
  user: AuthUserRow,
  supplied: unknown
) {
  if (
    typeof supplied !== 'string' ||
    !env.AUTH_RECOVERY_CODE_PEPPER
  ) {
    return false;
  }
  const normalized = supplied.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-9]{12}$/.test(normalized)) return false;
  let records: RecoveryCodeRecord[];
  try {
    const parsed: unknown = JSON.parse(user.recovery_codes_json);
    records = Array.isArray(parsed)
      ? parsed.filter(
          (item): item is RecoveryCodeRecord =>
            isRecord(item) &&
            typeof item.salt === 'string' &&
            typeof item.hash === 'string'
        )
      : [];
  } catch {
    records = [];
  }
  let matchedIndex = -1;
  for (let index = 0; index < records.length; index += 1) {
    const suppliedHash = await hmac(
      env.AUTH_RECOVERY_CODE_PEPPER,
      `recovery:${records[index].salt}:${normalized}`
    );
    if (
      !records[index].used_at &&
      (await timingSafeStringEqual(records[index].hash, suppliedHash))
    ) {
      matchedIndex = index;
    }
  }
  if (matchedIndex < 0) return false;
  records[matchedIndex] = { ...records[matchedIndex], used_at: nowIso() };
  const result = await env.DB.prepare(
    `UPDATE auth_users
       SET recovery_codes_json=?, updated_at=?
     WHERE id=? AND recovery_codes_json=?
       AND password_hash IS ? AND password_changed_at IS ?`
  )
    .bind(
      JSON.stringify(records),
      nowIso(),
      user.id,
      user.recovery_codes_json,
      user.password_hash,
      user.password_changed_at
    )
    .run();
  return result.meta.changes === 1;
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get('Cookie') || '';
  for (const item of cookie.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return '';
}

function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

async function csrfToken(env: AuthEnv, sessionToken: string) {
  if (!env.AUTH_SESSION_SECRET) {
    throw new Error('AUTH_SESSION_SECRET is missing');
  }
  return hmac(env.AUTH_SESSION_SECRET, `csrf:${sessionToken}`);
}

async function credentialVersion(
  env: AuthEnv,
  user: Pick<AuthUserRow, 'id' | 'password_hash' | 'password_changed_at'>
) {
  if (!env.AUTH_SESSION_SECRET) {
    throw new Error('AUTH_SESSION_SECRET is missing');
  }
  return hmac(
    env.AUTH_SESSION_SECRET,
    `${CREDENTIAL_VERSION_DOMAIN}${user.id}\u0000${user.password_changed_at || ''}\u0000${
      user.password_hash || ''
    }`
  );
}

function isUnsafeMethod(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function validateOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === new URL(request.url).origin;
}

function localPortalBypassEnabled(request: Request, env: AuthEnv) {
  const url = new URL(request.url);
  if (String(env.AUTH_LOCAL_BYPASS).toLowerCase() !== 'true') return false;
  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  );
}

async function createSession(
  env: AuthEnv,
  request: Request,
  user: Pick<AuthUserRow, 'id' | 'email' | 'role'>,
  credentialGuard?: {
    passwordHash: string;
    passwordChangedAt: string | null;
  }
) {
  const missing = missingAuthConfiguration(env);
  if (missing.length) return configurationError(missing);
  const context = await requestContext(request);
  const token = randomToken();
  const tokenHash = await sha256(`session:${token}`);
  const createdAt = nowIso();
  const expiresAt = futureIso(SESSION_SECONDS);
  const idleExpiresAt = futureIso(SESSION_IDLE_SECONDS);
  const sessionId = randomId('ses');
  const insertSession = credentialGuard
    ? env.DB.prepare(
        `INSERT INTO auth_sessions
          (id, user_id, token_hash, expires_at, idle_expires_at, last_seen_at,
           revoked_at, ip_hash, user_agent_hash, created_at)
         SELECT ?, u.id, ?, ?, ?, ?, NULL, ?, ?, ?
           FROM auth_users u
          WHERE u.id=? AND u.email=? AND u.role=? AND u.status='active'
            AND u.password_hash=? AND u.password_changed_at IS ?`
      ).bind(
        sessionId,
        tokenHash,
        expiresAt,
        idleExpiresAt,
        createdAt,
        context.ipHash,
        context.userAgentHash,
        createdAt,
        user.id,
        user.email,
        user.role,
        credentialGuard.passwordHash,
        credentialGuard.passwordChangedAt
      )
    : env.DB.prepare(
        `INSERT INTO auth_sessions
          (id, user_id, token_hash, expires_at, idle_expires_at, last_seen_at,
           revoked_at, ip_hash, user_agent_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      ).bind(
        sessionId,
        user.id,
        tokenHash,
        expiresAt,
        idleExpiresAt,
        createdAt,
        context.ipHash,
        context.userAgentHash,
        createdAt
      );
  const updateUser = credentialGuard
    ? env.DB.prepare(
        `UPDATE auth_users
           SET last_login_at=?, failed_password_attempts=0, locked_until=NULL,
               updated_at=?
         WHERE id=? AND password_hash=? AND password_changed_at IS ?`
      ).bind(
        createdAt,
        createdAt,
        user.id,
        credentialGuard.passwordHash,
        credentialGuard.passwordChangedAt
      )
    : env.DB.prepare(
        `UPDATE auth_users
           SET last_login_at=?, failed_password_attempts=0, locked_until=NULL,
               updated_at=?
         WHERE id=?`
      ).bind(createdAt, createdAt, user.id);
  const sessionResults = await env.DB.batch([insertSession, updateUser]);
  if (sessionResults[0].meta.changes !== 1) {
    return authError(401, 'invalid_challenge', '登录验证已失效，请重新登录');
  }
  return authJson(
    {
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        expires_at: expiresAt,
        csrf_token: await csrfToken(env, token),
      },
    },
    200,
    { 'set-cookie': sessionCookie(token) }
  );
}

async function loadSession(
  request: Request,
  env: AuthEnv
): Promise<{ row: SessionRow; token: string } | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length < 32 || token.length > 128) return null;
  const tokenHash = await sha256(`session:${token}`);
  const row = await env.DB.prepare(
    `SELECT
       s.id AS session_id,
       s.user_id,
       u.email,
       u.role,
       u.status AS user_status,
       s.expires_at,
       s.idle_expires_at,
       s.last_seen_at,
       s.revoked_at
     FROM auth_sessions s
     JOIN auth_users u ON u.id=s.user_id
     WHERE s.token_hash=?
     LIMIT 1`
  )
    .bind(tokenHash)
    .first<SessionRow>();
  if (
    !row ||
    row.revoked_at ||
    row.user_status !== 'active' ||
    hasExpired(row.expires_at) ||
    hasExpired(row.idle_expires_at)
  ) {
    return null;
  }
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
    const now = nowIso();
    const idleExpiresAt = minIso(
      row.expires_at,
      futureIso(SESSION_IDLE_SECONDS)
    );
    await env.DB.prepare(
      `UPDATE auth_sessions
         SET last_seen_at=?, idle_expires_at=?
       WHERE id=? AND revoked_at IS NULL`
    )
      .bind(now, idleExpiresAt, row.session_id)
      .run();
    row.last_seen_at = now;
    row.idle_expires_at = idleExpiresAt;
  }
  return { row, token };
}

function principalFromSession(row: SessionRow): AuthPrincipal {
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    via: 'session',
  };
}

async function sessionUserPayload(env: AuthEnv, principal: AuthPrincipal) {
  if (principal.role !== 'partner') {
    return {
      id: principal.userId,
      email: principal.email,
      role: principal.role,
      organization: null,
      membership: null,
      permissions: [],
    };
  }

  const portalPrincipal = await resolvePortalTeamPrincipal(env, principal);
  if (portalPrincipal instanceof Response) return portalPrincipal;
  return {
    id: portalPrincipal.userId,
    email: portalPrincipal.email,
    role: portalPrincipal.role,
    organization: {
      id: portalPrincipal.organizationId,
      name: portalPrincipal.organizationName,
      partner_key: portalPrincipal.partnerKey,
    },
    membership: {
      id: portalPrincipal.userId,
      role_id: portalPrincipal.roleId,
      role_code: portalPrincipal.roleCode,
      role_name: portalPrincipal.roleName,
      status: 'active',
    },
    permissions: portalPrincipal.permissions,
  };
}

async function validateSessionCsrf(
  request: Request,
  env: AuthEnv,
  token: string
) {
  if (!isUnsafeMethod(request.method)) return null;
  if (!validateOrigin(request)) {
    return authError(403, 'invalid_origin', '请求来源无效');
  }
  const supplied = request.headers.get('X-CSRF-Token')?.trim() || '';
  const expected = await csrfToken(env, token);
  return supplied && (await timingSafeStringEqual(supplied, expected))
    ? null
    : authError(403, 'invalid_csrf_token', 'CSRF token 无效或缺失');
}

export async function authorizeBrowserRequest(
  request: Request,
  env: AuthEnv,
  requiredRole: AuthRole
): Promise<AuthPrincipal | Response> {
  const missing = missingAuthConfiguration(env);
  if (!missing.length) {
    const session = await loadSession(request, env);
    if (session) {
      if (session.row.role !== requiredRole) {
        return authError(403, 'forbidden', '当前账户无权访问此资源');
      }
      const csrfError = await validateSessionCsrf(request, env, session.token);
      return csrfError || principalFromSession(session.row);
    }
  }
  if (missing.length) return configurationError(missing);
  return authError(401, 'authentication_required', '请先登录');
}

export async function authorizeLegacyHumanRequest(
  request: Request,
  env: AuthEnv,
  requiredRole: AuthRole
): Promise<AuthPrincipal | Response> {
  return authorizeBrowserRequest(request, env, requiredRole);
}

export async function verifyAuthenticatedTotpStepUp(
  request: Request,
  env: AuthEnv,
  principal: AuthPrincipal,
  code: unknown,
  purpose: 'api_credential_reveal' | 'webhook_secret_reveal' | 'password_change'
): Promise<Response | null> {
  if (
    (purpose === 'api_credential_reveal' || purpose === 'webhook_secret_reveal') &&
    localPortalBypassEnabled(request, env) &&
    typeof code === 'string' &&
    /^\d{6}$/.test(code)
  ) {
    return null;
  }
  const missing = missingAuthConfiguration(env, { totp: true });
  if (missing.length) return configurationError(missing);

  const context = await requestContext(request);
  const coarseLimit = await coarseAuthRateLimit(env, context);
  if (coarseLimit) return coarseLimit;
  const rateLimit = await enforceD1RateLimit(
    env,
    `step-up:${principal.userId}:${purpose}`,
    6,
    5 * 60,
    15 * 60
  );
  if (rateLimit) {
    await auditAuth(env, context, 'auth.step_up_totp', 'blocked', {
      userId: principal.userId,
      email: principal.email,
      metadata: { purpose },
    });
    return rateLimit;
  }

  const user = await env.DB.prepare(
    `SELECT * FROM auth_users WHERE id=? AND email=? AND role=? LIMIT 1`
  )
    .bind(principal.userId, principal.email, principal.role)
    .first<AuthUserRow>();
  if (
    !user ||
    user.status !== 'active' ||
    user.totp_enabled !== 1 ||
    !user.totp_secret_ciphertext ||
    !user.totp_secret_iv
  ) {
    await auditAuth(env, context, 'auth.step_up_totp', 'failure', {
      userId: principal.userId,
      email: principal.email,
      metadata: { purpose, reason: 'account_not_ready' },
    });
    return authError(401, 'step_up_required', '需要重新完成双重验证');
  }

  const secret = await decryptTotpSecret(
    env,
    user.id,
    user.totp_secret_ciphertext,
    user.totp_secret_iv
  );
  const acceptedCounter = await verifyTotp(secret, code);
  if (
    acceptedCounter === null ||
    acceptedCounter <= user.last_totp_counter
  ) {
    await auditAuth(env, context, 'auth.step_up_totp', 'failure', {
      userId: user.id,
      email: user.email,
      metadata: { purpose, reason: 'invalid_or_replayed_code' },
    });
    return authError(
      401,
      'invalid_totp_code',
      '验证码无效、已过期或已使用'
    );
  }

  const now = nowIso();
  const updated = await env.DB.prepare(
    `UPDATE auth_users
       SET last_totp_counter=?,updated_at=?
     WHERE id=? AND last_totp_counter<?`
  )
    .bind(acceptedCounter, now, user.id, acceptedCounter)
    .run();
  if (updated.meta.changes !== 1) {
    await auditAuth(env, context, 'auth.step_up_totp', 'failure', {
      userId: user.id,
      email: user.email,
      metadata: { purpose, reason: 'counter_replayed' },
    });
    return authError(401, 'invalid_totp_code', '验证码已使用');
  }

  await auditAuth(env, context, 'auth.step_up_totp', 'success', {
    userId: user.id,
    email: user.email,
    metadata: { purpose },
  });
  return null;
}

async function handleSetupToken(request: Request, env: AuthEnv) {
  if (request.method !== 'POST') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (!env.AUTH_BOOTSTRAP_SECRET) {
    return configurationError(['AUTH_BOOTSTRAP_SECRET']);
  }
  const context = await requestContext(request);
  const coarseLimit = await coarseAuthRateLimit(env, context);
  if (coarseLimit) return coarseLimit;
  const rateLimit = await enforceD1RateLimit(
    env,
    `setup-token:${context.ipHash}`,
    10,
    60 * 60,
    60 * 60
  );
  if (rateLimit) {
    await auditAuth(env, context, 'auth.setup_token', 'blocked');
    return rateLimit;
  }
  const authorization = request.headers.get('Authorization') || '';
  const bearer = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
  if (
    !bearer ||
    !(await timingSafeStringEqual(bearer, env.AUTH_BOOTSTRAP_SECRET))
  ) {
    await auditAuth(env, context, 'auth.setup_token', 'failure');
    return authError(401, 'invalid_bootstrap_secret', 'Bootstrap 凭证无效');
  }
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const email = normalizeEmail(body.email);
  const role = body.role;
  const purpose =
    body.purpose === undefined ? 'initial_setup' : body.purpose;
  if (purpose !== 'initial_setup' && purpose !== 'credential_reset') {
    await auditAuth(env, context, 'auth.setup_token', 'failure', {
      email,
      metadata: { purpose: body.purpose },
    });
    return authError(
      422,
      'invalid_setup_purpose',
      'purpose 仅支持 initial_setup 或 credential_reset'
    );
  }
  if (
    (role !== 'admin' && role !== 'partner') ||
    !isEmail(email) ||
    !configuredEmails(env, role).includes(email)
  ) {
    await auditAuth(env, context, 'auth.setup_token', 'failure', { email });
    return authError(
      422,
      'identity_not_configured',
      '只允许为预先配置的管理员或合作方账户签发 setup token'
    );
  }
  const existing = await env.DB.prepare(
    `SELECT id, role, setup_completed_at FROM auth_users WHERE email=?`
  )
    .bind(email)
    .first<{ id: string; role: AuthRole; setup_completed_at: string | null }>();
  if (existing && existing.role !== role) {
    return authError(409, 'identity_role_conflict', '账户角色与配置不一致');
  }
  if (purpose === 'initial_setup' && existing?.setup_completed_at) {
    return authError(409, 'setup_already_completed', '该账户已完成初始化');
  }
  if (purpose === 'credential_reset' && !existing?.setup_completed_at) {
    await auditAuth(env, context, 'auth.credential_reset', 'failure', {
      userId: existing?.id,
      email,
      metadata: { role, reason: 'setup_not_completed' },
    });
    return authError(
      409,
      'credential_reset_not_available',
      '仅已完成初始化的账户可执行凭据重置'
    );
  }
  const userId = existing?.id || randomId('usr');
  const token = randomToken();
  const tokenHash = await sha256(`setup:${token}`);
  const setupTokenId = randomId('stp');
  const createdAt = nowIso();
  const expiresAt = futureIso(SETUP_TOKEN_SECONDS);
  let resetRevokedSessions: number | undefined;
  if (purpose === 'credential_reset') {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO auth_setup_tokens
          (id, user_id, token_hash, expires_at, used_at, created_at)
         SELECT ?, id, ?, ?, NULL, ?
         FROM auth_users
         WHERE id=? AND role=? AND setup_completed_at IS NOT NULL`
      ).bind(
        setupTokenId,
        tokenHash,
        expiresAt,
        createdAt,
        userId,
        role
      ),
      env.DB.prepare(
        `UPDATE auth_sessions
           SET revoked_at=?
         WHERE user_id=? AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM auth_setup_tokens
             WHERE id=? AND user_id=?
           )`
      ).bind(createdAt, userId, setupTokenId, userId),
      env.DB.prepare(
        `UPDATE auth_login_challenges
           SET consumed_at=?
         WHERE user_id=? AND consumed_at IS NULL
           AND EXISTS (
             SELECT 1 FROM auth_setup_tokens
             WHERE id=? AND user_id=?
           )`
      ).bind(createdAt, userId, setupTokenId, userId),
      env.DB.prepare(
        `UPDATE auth_totp_enrollments
           SET verified_at=?
         WHERE user_id=? AND verified_at IS NULL
           AND EXISTS (
             SELECT 1 FROM auth_setup_tokens
             WHERE id=? AND user_id=?
           )`
      ).bind(createdAt, userId, setupTokenId, userId),
      env.DB.prepare(
        `UPDATE auth_setup_tokens
           SET used_at=?
         WHERE user_id=? AND id<>? AND used_at IS NULL
           AND EXISTS (
             SELECT 1 FROM auth_setup_tokens
             WHERE id=? AND user_id=?
           )`
      ).bind(createdAt, userId, setupTokenId, setupTokenId, userId),
      env.DB.prepare(
        `UPDATE auth_users
           SET password_hash=NULL, password_salt=NULL,
               password_iterations=NULL, password_changed_at=NULL,
               totp_secret_ciphertext=NULL, totp_secret_iv=NULL,
               totp_enabled=0, last_totp_counter=-1,
               recovery_codes_json='[]', failed_password_attempts=0,
               locked_until=NULL, setup_completed_at=NULL, updated_at=?
         WHERE id=? AND role=? AND setup_completed_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM auth_setup_tokens
             WHERE id=? AND user_id=?
           )`
      ).bind(createdAt, userId, role, setupTokenId, userId),
    ]);
    if (results[0].meta.changes !== 1 || results[5].meta.changes !== 1) {
      await auditAuth(env, context, 'auth.credential_reset', 'failure', {
        userId,
        email,
        metadata: { role, reason: 'state_changed' },
      });
      return authError(
        409,
        'credential_reset_state_changed',
        '账户凭据状态已变化，请重新发起重置'
      );
    }
    resetRevokedSessions = results[1].meta.changes;
  } else {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO auth_users
          (id, email, role, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)
         ON CONFLICT(email) DO UPDATE SET updated_at=excluded.updated_at`
      ).bind(userId, email, role, createdAt, createdAt),
      env.DB.prepare(
        `UPDATE auth_setup_tokens
           SET used_at=?
         WHERE user_id=? AND used_at IS NULL`
      ).bind(createdAt, userId),
      env.DB.prepare(
        `INSERT INTO auth_setup_tokens
          (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      ).bind(setupTokenId, userId, tokenHash, expiresAt, createdAt),
    ]);
  }
  const auditEvent =
    purpose === 'credential_reset'
      ? 'auth.credential_reset'
      : 'auth.setup_token';
  await auditAuth(env, context, auditEvent, 'success', {
    userId,
    email,
    metadata: {
      role,
      purpose,
      ...(purpose === 'credential_reset'
        ? { revoked_sessions: resetRevokedSessions }
        : {}),
    },
  });
  return authJson({
    data: { setup_token: token, expires_at: expiresAt, purpose },
  });
}

async function handleSetupComplete(
  request: Request,
  env: AuthEnv,
  expectedRole: AuthRole
) {
  if (request.method !== 'POST') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  const missing = missingAuthConfiguration(env, { password: true });
  if (missing.length) return configurationError(missing);
  const context = await requestContext(request);
  const coarseLimit = await coarseAuthRateLimit(env, context);
  if (coarseLimit) return coarseLimit;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const setupToken =
    typeof body.setup_token === 'string' ? body.setup_token.trim() : '';
  if (!setupToken) {
    await auditAuth(env, context, 'auth.setup_complete', 'failure');
    return authError(401, 'invalid_setup_token', 'Setup token 无效或已过期');
  }
  const validationError = passwordValidationError(body.password);
  if (validationError) return validationError;
  const rateLimit = await enforceD1RateLimit(
    env,
    `setup-complete:${context.ipHash}`,
    12,
    10 * 60,
    15 * 60
  );
  if (rateLimit) return rateLimit;
  if (expectedRole === 'partner') {
    const invitationPreparation = await beginPortalInvitationEnrollment(
      env,
      setupToken
    );
    if (invitationPreparation instanceof Response) {
      await auditAuth(env, context, 'auth.setup_complete', 'failure', {
        metadata: { reason: 'portal_invitation_rejected' },
      });
      return invitationPreparation;
    }
  }
  const setupTokenHash = await sha256(`setup:${setupToken}`);
  const token = await env.DB.prepare(
    `SELECT
       t.id, t.user_id, t.expires_at, t.used_at,
       u.email, u.role, u.setup_completed_at
     FROM auth_setup_tokens t
     JOIN auth_users u ON u.id=t.user_id
     WHERE t.token_hash=?
     LIMIT 1`
  )
    .bind(setupTokenHash)
    .first<SetupTokenRow>();
  if (
    !token ||
    token.used_at ||
    hasExpired(token.expires_at) ||
    token.setup_completed_at ||
    token.role !== expectedRole
  ) {
    await auditAuth(env, context, 'auth.setup_complete', 'failure');
    return authError(401, 'invalid_setup_token', 'Setup token 无效或已过期');
  }
  const password = body.password as string;
  const passwordRecord = await hashPassword(env, password);
  const enrollmentToken = randomToken();
  const enrollmentTokenHash = await sha256(`enrollment:${enrollmentToken}`);
  const createdAt = nowIso();
  const expiresAt = futureIso(ENROLLMENT_SECONDS);
  const claimed = await env.DB.prepare(
    `UPDATE auth_setup_tokens
       SET used_at=?
     WHERE id=? AND used_at IS NULL AND expires_at>?
     RETURNING user_id`
  )
    .bind(createdAt, token.id, createdAt)
    .first<{ user_id: string }>();
  if (!claimed || claimed.user_id !== token.user_id) {
    await auditAuth(env, context, 'auth.setup_complete', 'failure', {
      userId: token.user_id,
      email: token.email,
    });
    return authError(409, 'setup_token_consumed', 'Setup token 已被使用');
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_users
         SET password_hash=?, password_salt=?, password_iterations=?,
             password_changed_at=?, updated_at=?
       WHERE id=? AND setup_completed_at IS NULL
         AND EXISTS (
           SELECT 1 FROM auth_setup_tokens
           WHERE id=? AND used_at=? AND expires_at>?
         )`
    ).bind(
      passwordRecord.hash,
      passwordRecord.salt,
      passwordRecord.iterations,
      createdAt,
      createdAt,
      token.user_id,
      token.id,
      createdAt,
      createdAt
    ),
    env.DB.prepare(
      `UPDATE auth_totp_enrollments SET verified_at=?
       WHERE user_id=? AND verified_at IS NULL
         AND EXISTS (
           SELECT 1 FROM auth_users
           WHERE id=? AND setup_completed_at IS NULL
             AND password_changed_at=?
         )`
    ).bind(createdAt, token.user_id, token.user_id, createdAt),
    env.DB.prepare(
      `INSERT INTO auth_totp_enrollments
        (id, user_id, token_hash, secret_ciphertext, secret_iv,
         expires_at, verified_at, created_at)
       SELECT ?, ?, ?, NULL, NULL, ?, NULL, ?
       WHERE EXISTS (
         SELECT 1
         FROM auth_users u
         JOIN auth_setup_tokens t ON t.user_id=u.id
         WHERE u.id=? AND u.setup_completed_at IS NULL
           AND u.password_changed_at=?
           AND t.id=? AND t.used_at=?
       )`
    ).bind(
      randomId('ten'),
      token.user_id,
      enrollmentTokenHash,
      expiresAt,
      createdAt,
      token.user_id,
      createdAt,
      token.id,
      createdAt
    ),
  ]);
  if (results[0].meta.changes !== 1 || results[2].meta.changes !== 1) {
    await auditAuth(env, context, 'auth.setup_complete', 'failure', {
      userId: token.user_id,
      email: token.email,
    });
    return authError(409, 'setup_token_consumed', 'Setup token 已被使用');
  }
  await auditAuth(env, context, 'auth.setup_complete', 'success', {
    userId: token.user_id,
    email: token.email,
  });
  return authJson({
    data: { enrollment_token: enrollmentToken, expires_at: expiresAt },
  });
}

async function loadEnrollment(env: AuthEnv, token: string) {
  const tokenHash = await sha256(`enrollment:${token}`);
  return env.DB.prepare(
    `SELECT
       e.id, e.user_id, e.expires_at, e.verified_at,
       e.secret_ciphertext, e.secret_iv, u.email, u.role
     FROM auth_totp_enrollments e
     JOIN auth_users u ON u.id=e.user_id
     WHERE e.token_hash=?
     LIMIT 1`
  )
    .bind(tokenHash)
    .first<EnrollmentRow>();
}

async function handleTotpSetup(
  request: Request,
  env: AuthEnv,
  expectedRole: AuthRole
) {
  if (request.method !== 'POST') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  const missing = missingAuthConfiguration(env, { totp: true });
  if (missing.length) return configurationError(missing);
  const context = await requestContext(request);
  const coarseLimit = await coarseAuthRateLimit(env, context);
  if (coarseLimit) return coarseLimit;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const enrollmentToken =
    typeof body.enrollment_token === 'string'
      ? body.enrollment_token.trim()
      : '';
  if (!enrollmentToken) {
    await auditAuth(env, context, 'auth.totp_setup', 'failure');
    return authError(
      401,
      'invalid_enrollment_token',
      'Enrollment token 无效或已过期'
    );
  }
  const enrollment = await loadEnrollment(env, enrollmentToken);
  if (
    !enrollment ||
    enrollment.verified_at ||
    hasExpired(enrollment.expires_at) ||
    enrollment.role !== expectedRole
  ) {
    await auditAuth(env, context, 'auth.totp_setup', 'failure');
    return authError(
      401,
      'invalid_enrollment_token',
      'Enrollment token 无效或已过期'
    );
  }
  let secret: Uint8Array;
  if (enrollment.secret_ciphertext && enrollment.secret_iv) {
    secret = await decryptTotpSecret(
      env,
      enrollment.user_id,
      enrollment.secret_ciphertext,
      enrollment.secret_iv
    );
  } else {
    secret = new Uint8Array(20);
    crypto.getRandomValues(secret);
    const encrypted = await encryptTotpSecret(env, enrollment.user_id, secret);
    const result = await env.DB.prepare(
      `UPDATE auth_totp_enrollments
         SET secret_ciphertext=?, secret_iv=?
       WHERE id=? AND secret_ciphertext IS NULL AND verified_at IS NULL`
    )
      .bind(encrypted.ciphertext, encrypted.iv, enrollment.id)
      .run();
    if (result.meta.changes !== 1) {
      return authError(
        409,
        'enrollment_state_changed',
        'TOTP 初始化状态已变化，请重试'
      );
    }
  }
  const encodedSecret = base32Encode(secret);
  const issuer = 'Fidere VA';
  const label = `${issuer}:${enrollment.email}`;
  const otpauthUri =
    `otpauth://totp/${encodeURIComponent(label)}` +
    `?secret=${encodedSecret}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    '&algorithm=SHA1&digits=6&period=30';
  await auditAuth(env, context, 'auth.totp_setup', 'success', {
    userId: enrollment.user_id,
    email: enrollment.email,
  });
  return authJson({
    data: {
      enrollment_token: enrollmentToken,
      secret: encodedSecret,
      otpauth_uri: otpauthUri,
      expires_at: enrollment.expires_at,
    },
  });
}

async function handleEnrollmentVerification(
  request: Request,
  env: AuthEnv,
  body: Record<string, unknown>,
  context: RequestContext,
  expectedRole: AuthRole
) {
  const enrollmentToken = String(body.enrollment_token || '').trim();
  const enrollment = await loadEnrollment(env, enrollmentToken);
  if (
    !enrollment ||
    enrollment.verified_at ||
    hasExpired(enrollment.expires_at) ||
    !enrollment.secret_ciphertext ||
    !enrollment.secret_iv ||
    enrollment.role !== expectedRole
  ) {
    await auditAuth(env, context, 'auth.totp_enroll', 'failure');
    return authError(
      401,
      'invalid_enrollment_token',
      'Enrollment token 无效或已过期'
    );
  }
  const secret = await decryptTotpSecret(
    env,
    enrollment.user_id,
    enrollment.secret_ciphertext,
    enrollment.secret_iv
  );
  const acceptedCounter = await verifyTotp(secret, body.code);
  if (acceptedCounter === null) {
    await auditAuth(env, context, 'auth.totp_enroll', 'failure', {
      userId: enrollment.user_id,
      email: enrollment.email,
    });
    return authError(401, 'invalid_totp_code', '验证码无效或已过期');
  }
  const recovery = await createRecoveryCodes(env);
  const verifiedAt = nowIso();
  let invitationStatements: D1PreparedStatement[] = [];
  if (expectedRole === 'partner') {
    try {
      invitationStatements = await portalInvitationEnrollmentStatements(
        env,
        enrollment.user_id,
        verifiedAt
      );
    } catch (caught) {
      if (
        (caught instanceof Error ? caught.message : '').includes(
          'portal_invitation_activation_invalid'
        )
      ) {
        await auditAuth(env, context, 'auth.totp_enroll', 'failure', {
          userId: enrollment.user_id,
          email: enrollment.email,
          metadata: { reason: 'portal_invitation_activation_invalid' },
        });
        return authError(
          409,
          'invitation_activation_failed',
          '团队邀请状态已变化，请联系组织 Owner 重新邀请'
        );
      }
      throw caught;
    }
  }
  let results: D1Result<unknown>[];
  try {
    results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_totp_enrollments
         SET verified_at=?
       WHERE id=? AND verified_at IS NULL AND expires_at>?`
    ).bind(verifiedAt, enrollment.id, verifiedAt),
    env.DB.prepare(
      `UPDATE auth_users
         SET totp_secret_ciphertext=?, totp_secret_iv=?, totp_enabled=1,
             recovery_codes_json=?, last_totp_counter=?, setup_completed_at=?,
             failed_password_attempts=0, locked_until=NULL, updated_at=?
       WHERE id=? AND setup_completed_at IS NULL`
    ).bind(
      enrollment.secret_ciphertext,
      enrollment.secret_iv,
      JSON.stringify(recovery.records),
      acceptedCounter,
      verifiedAt,
      verifiedAt,
      enrollment.user_id
    ),
    env.DB.prepare(
      `UPDATE auth_totp_enrollments
         SET verified_at=?
       WHERE user_id=? AND id<>? AND verified_at IS NULL`
    ).bind(verifiedAt, enrollment.user_id, enrollment.id),
      ...invitationStatements,
    ]);
  } catch (caught) {
    if (invitationStatements.length) {
      await auditAuth(env, context, 'auth.totp_enroll', 'failure', {
        userId: enrollment.user_id,
        email: enrollment.email,
        metadata: { reason: 'portal_invitation_activation_failed' },
      });
      return authError(
        409,
        'invitation_activation_failed',
        '团队邀请激活失败，请联系组织 Owner 重新邀请'
      );
    }
    throw caught;
  }
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    return authError(
      409,
      'enrollment_state_changed',
      'TOTP 初始化状态已变化，请重新开始'
    );
  }
  const activatedUser = await env.DB.prepare(
    `SELECT * FROM auth_users
      WHERE id=? AND email=? AND role=? AND status='active'
        AND setup_completed_at=? AND totp_enabled=1
      LIMIT 1`
  )
    .bind(
      enrollment.user_id,
      enrollment.email,
      enrollment.role,
      verifiedAt
    )
    .first<AuthUserRow>();
  if (!activatedUser?.password_hash) {
    await auditAuth(env, context, 'auth.totp_enroll', 'failure', {
      userId: enrollment.user_id,
      email: enrollment.email,
      metadata: { reason: 'credential_changed' },
    });
    return authError(
      409,
      'enrollment_state_changed',
      'TOTP 初始化状态已变化，请重新开始'
    );
  }
  const session = await createSession(
    env,
    request,
    activatedUser,
    {
      passwordHash: activatedUser.password_hash,
      passwordChangedAt: activatedUser.password_changed_at,
    }
  );
  await auditAuth(env, context, 'auth.totp_enroll', session.ok ? 'success' : 'failure', {
    userId: enrollment.user_id,
    email: enrollment.email,
    metadata: session.ok ? {} : { reason: 'credential_changed' },
  });
  if (!session.ok) return session;
  const payload = (await session.json()) as {
    data: Record<string, unknown>;
  };
  return authJson(
    {
      data: {
        ...payload.data,
        recovery_codes: recovery.codes,
      },
    },
    200,
    { 'set-cookie': session.headers.get('set-cookie') || '' }
  );
}

async function handleLocalPortalLogin(request: Request, env: AuthEnv) {
  if (!validateOrigin(request)) {
    return authError(403, 'invalid_origin', '请求来源无效');
  }
  const missing = missingAuthConfiguration(env);
  if (missing.length) return configurationError(missing);
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const account = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (
    !account ||
    account.length > 254 ||
    !password ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return authError(422, 'validation_error', '本地测试账户和密码不能为空');
  }

  const now = nowIso();
  const user = {
    id: 'usr_local_portal',
    email: 'local.portal@localhost.test',
    role: 'partner' as const,
  };
  const upsert = await env.DB.prepare(
    `INSERT INTO auth_users
      (id,email,role,status,password_hash,password_salt,password_iterations,
       totp_secret_ciphertext,totp_secret_iv,totp_enabled,last_totp_counter,
       recovery_codes_json,failed_password_attempts,locked_until,
       setup_completed_at,password_changed_at,last_login_at,created_at,updated_at)
     VALUES (?,?,'partner','active',NULL,NULL,NULL,NULL,NULL,0,-1,'[]',0,NULL,
             ?,NULL,NULL,?,?)
     ON CONFLICT(id) DO UPDATE SET
       status='active',
       failed_password_attempts=0,
       locked_until=NULL,
       updated_at=excluded.updated_at
     WHERE auth_users.email=excluded.email
       AND auth_users.role='partner'`
  )
    .bind(user.id, user.email, now, now, now)
    .run();

  const context = await requestContext(request);
  const storedUser = await env.DB.prepare(
    `SELECT id,email,role,status
       FROM auth_users
      WHERE id=?
      LIMIT 1`
  )
    .bind(user.id)
    .first<Pick<AuthUserRow, 'id' | 'email' | 'role' | 'status'>>();
  if (
    upsert.meta.changes !== 1 ||
    !storedUser ||
    storedUser.email !== user.email ||
    storedUser.role !== 'partner' ||
    storedUser.status !== 'active'
  ) {
    await auditAuth(env, context, 'auth.local_portal_bypass', 'failure', {
      userId: storedUser?.id,
      email: storedUser?.email,
      metadata: { reason: 'local_identity_conflict' },
    });
    return authError(
      409,
      'local_identity_conflict',
      '本地测试身份存在冲突，请清理本地测试数据库后重试'
    );
  }

  const response = await createSession(env, request, storedUser);
  if (!response.ok) {
    await auditAuth(env, context, 'auth.local_portal_bypass', 'failure', {
      userId: storedUser.id,
      email: storedUser.email,
      metadata: { reason: 'session_creation_failed' },
    });
    return response;
  }
  await auditAuth(env, context, 'auth.local_portal_bypass', 'success', {
    userId: storedUser.id,
    email: storedUser.email,
    metadata: { loopback_only: true },
  });
  response.headers.set('X-Local-Auth-Bypass', 'true');
  return response;
}

async function handleLogin(
  request: Request,
  env: AuthEnv,
  expectedRole: AuthRole
) {
  if (request.method !== 'POST') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (expectedRole === 'partner' && localPortalBypassEnabled(request, env)) {
    return handleLocalPortalLogin(request, env);
  }
  const missing = missingAuthConfiguration(env, { password: true });
  if (missing.length) return configurationError(missing);
  const context = await requestContext(request);
  const coarseLimit = await coarseAuthRateLimit(env, context);
  if (coarseLimit) return coarseLimit;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!isEmail(email) || !password || password.length > PASSWORD_MAX_LENGTH) {
    await auditAuth(env, context, 'auth.login_password', 'failure', { email });
    return authError(401, 'invalid_credentials', '邮箱或密码不正确');
  }
  const ipLimit = await enforceD1RateLimit(
    env,
    `login-ip:${context.ipHash}`,
    30,
    10 * 60,
    15 * 60
  );
  if (ipLimit) {
    await auditAuth(env, context, 'auth.login_password', 'blocked', { email });
    return ipLimit;
  }
  const emailLimit = await enforceD1RateLimit(
    env,
    `login-email:${email}`,
    8,
    10 * 60,
    15 * 60
  );
  if (emailLimit) {
    await auditAuth(env, context, 'auth.login_password', 'blocked', { email });
    return emailLimit;
  }
  const user = await env.DB.prepare(
    `SELECT * FROM auth_users WHERE email=? LIMIT 1`
  )
    .bind(email)
    .first<AuthUserRow>();
  const validPassword = await verifyPassword(env, password, user);
  const isLocked = Boolean(user?.locked_until && !hasExpired(user.locked_until));
  if (
    !user ||
    !validPassword ||
    isLocked ||
    user.status !== 'active' ||
    !user.setup_completed_at ||
    user.totp_enabled !== 1 ||
    user.role !== expectedRole
  ) {
    if (user && !isLocked && !validPassword) {
      const failedAt = nowIso();
      const nextLockedUntil = futureIso(PASSWORD_LOCK_SECONDS);
      await env.DB.prepare(
        `UPDATE auth_users
           SET failed_password_attempts=CASE
                 WHEN locked_until IS NOT NULL AND locked_until<=? THEN 1
                 ELSE failed_password_attempts+1
               END,
               locked_until=CASE
                 WHEN (
                   CASE
                     WHEN locked_until IS NOT NULL AND locked_until<=? THEN 1
                     ELSE failed_password_attempts+1
                   END
                 )>=?
                   THEN ?
                 ELSE NULL
               END,
               updated_at=?
         WHERE id=?`
      )
        .bind(
          failedAt,
          failedAt,
          MAX_FAILED_PASSWORD_ATTEMPTS,
          nextLockedUntil,
          failedAt,
          user.id
        )
        .run();
    }
    await auditAuth(
      env,
      context,
      'auth.login_password',
      isLocked ? 'blocked' : 'failure',
      { userId: user?.id, email }
    );
    return authError(401, 'invalid_credentials', '邮箱或密码不正确');
  }
  const challengeId = randomId('chl');
  const createdAt = nowIso();
  const expiresAt = futureIso(LOGIN_CHALLENGE_SECONDS);
  const verifiedPasswordHash = user.password_hash as string;
  const challengeCredentialVersion = await credentialVersion(env, user);
  const challengeResults = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_login_challenges
        (id, user_id, expires_at, attempts, consumed_at, ip_hash,
         user_agent_hash, created_at, credential_version)
       SELECT ?, u.id, ?, 0, NULL, ?, ?, ?, ?
         FROM auth_users u
        WHERE u.id=? AND u.email=? AND u.role=? AND u.status='active'
          AND u.password_hash=? AND u.password_changed_at IS ?`
    ).bind(
      challengeId,
      expiresAt,
      context.ipHash,
      context.userAgentHash,
      createdAt,
      challengeCredentialVersion,
      user.id,
      user.email,
      user.role,
      verifiedPasswordHash,
      user.password_changed_at
    ),
    env.DB.prepare(
      `UPDATE auth_users
         SET failed_password_attempts=0, locked_until=NULL, updated_at=?
       WHERE id=? AND password_hash=? AND password_changed_at IS ?`
    ).bind(
      createdAt,
      user.id,
      verifiedPasswordHash,
      user.password_changed_at
    ),
    env.DB.prepare(
      `UPDATE auth_login_challenges
         SET consumed_at=?
       WHERE user_id=? AND id<>? AND consumed_at IS NULL
         AND EXISTS (
           SELECT 1 FROM auth_users u
            WHERE u.id=? AND u.password_hash=?
              AND u.password_changed_at IS ?
         )`
    ).bind(
      createdAt,
      user.id,
      challengeId,
      user.id,
      verifiedPasswordHash,
      user.password_changed_at
    ),
  ]);
  if (challengeResults[0].meta.changes !== 1) {
    await auditAuth(env, context, 'auth.login_password', 'failure', {
      userId: user.id,
      email,
      metadata: { reason: 'credential_changed' },
    });
    return authError(401, 'invalid_credentials', '邮箱或密码不正确');
  }
  await auditAuth(env, context, 'auth.login_password', 'success', {
    userId: user.id,
    email,
  });
  return authJson({
    data: {
      challenge_id: challengeId,
      requires_totp: true,
      expires_at: expiresAt,
    },
  });
}

async function handleLoginVerification(
  request: Request,
  env: AuthEnv,
  body: Record<string, unknown>,
  context: RequestContext,
  expectedRole: AuthRole
) {
  const challengeId = String(body.challenge_id || '').trim();
  if (!challengeId) {
    return authError(401, 'invalid_challenge', '登录验证已失效，请重新登录');
  }
  const challenge = await env.DB.prepare(
    `SELECT
       c.id AS challenge_id,
       c.credential_version AS challenge_credential_version,
       c.expires_at AS challenge_expires_at,
       c.attempts AS challenge_attempts,
       c.consumed_at AS challenge_consumed_at,
       c.ip_hash AS challenge_ip_hash,
       c.user_agent_hash AS challenge_user_agent_hash,
       u.*
     FROM auth_login_challenges c
     JOIN auth_users u ON u.id=c.user_id
     WHERE c.id=?
     LIMIT 1`
  )
    .bind(challengeId)
    .first<LoginChallengeRow>();
  if (
    !challenge ||
    !challenge.challenge_credential_version ||
    challenge.challenge_consumed_at ||
    hasExpired(challenge.challenge_expires_at) ||
    challenge.challenge_attempts >= MAX_CHALLENGE_ATTEMPTS ||
    challenge.status !== 'active' ||
    !challenge.password_hash ||
    challenge.totp_enabled !== 1 ||
    !challenge.totp_secret_ciphertext ||
    !challenge.totp_secret_iv ||
    challenge.challenge_ip_hash !== context.ipHash ||
    challenge.challenge_user_agent_hash !== context.userAgentHash ||
    challenge.role !== expectedRole
  ) {
    await auditAuth(env, context, 'auth.login_totp', 'failure');
    return authError(401, 'invalid_challenge', '登录验证已失效，请重新登录');
  }
  const activeCredentialVersion = await credentialVersion(env, challenge);
  if (activeCredentialVersion !== challenge.challenge_credential_version) {
    await auditAuth(env, context, 'auth.login_totp', 'failure', {
      userId: challenge.id,
      email: challenge.email,
      metadata: { reason: 'credential_changed' },
    });
    return authError(401, 'invalid_challenge', '登录验证已失效，请重新登录');
  }
  let accepted = false;
  let usedRecoveryCode = false;
  let acceptedCounter: number | null = null;
  if (body.recovery_code !== undefined) {
    accepted = await consumeRecoveryCode(env, challenge, body.recovery_code);
    usedRecoveryCode = accepted;
  } else {
    const secret = await decryptTotpSecret(
      env,
      challenge.id,
      challenge.totp_secret_ciphertext,
      challenge.totp_secret_iv
    );
    acceptedCounter = await verifyTotp(secret, body.code);
    accepted =
      acceptedCounter !== null &&
      acceptedCounter > challenge.last_totp_counter;
  }
  if (!accepted) {
    await env.DB.prepare(
      `UPDATE auth_login_challenges
         SET attempts=attempts+1,
             consumed_at=CASE WHEN attempts+1>=? THEN ? ELSE consumed_at END
       WHERE id=? AND consumed_at IS NULL AND credential_version=?
         AND EXISTS (
           SELECT 1 FROM auth_users u
            WHERE u.id=? AND u.password_hash=?
              AND u.password_changed_at IS ?
         )`
    )
      .bind(
        MAX_CHALLENGE_ATTEMPTS,
        nowIso(),
        challenge.challenge_id,
        challenge.challenge_credential_version,
        challenge.id,
        challenge.password_hash,
        challenge.password_changed_at
      )
      .run();
    await auditAuth(env, context, 'auth.login_totp', 'failure', {
      userId: challenge.id,
      email: challenge.email,
    });
    return authError(401, 'invalid_totp_code', '验证码或恢复码无效');
  }
  const consumedAt = nowIso();
  const consumeStatements = [
    env.DB.prepare(
      `UPDATE auth_login_challenges
         SET consumed_at=?
       WHERE id=? AND consumed_at IS NULL AND expires_at>?
         AND credential_version=?
         AND EXISTS (
           SELECT 1 FROM auth_users u
            WHERE u.id=? AND u.password_hash=?
              AND u.password_changed_at IS ?
         )`
    ).bind(
      consumedAt,
      challenge.challenge_id,
      consumedAt,
      challenge.challenge_credential_version,
      challenge.id,
      challenge.password_hash,
      challenge.password_changed_at
    ),
  ];
  if (!usedRecoveryCode && acceptedCounter !== null) {
    consumeStatements.push(
      env.DB.prepare(
        `UPDATE auth_users
         SET last_totp_counter=?, updated_at=?
         WHERE id=? AND last_totp_counter<?
           AND password_hash=? AND password_changed_at IS ?`
      ).bind(
        acceptedCounter,
        consumedAt,
        challenge.id,
        acceptedCounter,
        challenge.password_hash,
        challenge.password_changed_at
      )
    );
  }
  const consumeResults = await env.DB.batch(consumeStatements);
  if (
    consumeResults[0].meta.changes !== 1 ||
    (!usedRecoveryCode && consumeResults[1]?.meta.changes !== 1)
  ) {
    return authError(409, 'challenge_consumed', '登录验证已被使用');
  }
  const sessionResponse = await createSession(env, request, challenge, {
    passwordHash: challenge.password_hash,
    passwordChangedAt: challenge.password_changed_at,
  });
  await auditAuth(env, context, 'auth.login_totp', sessionResponse.ok ? 'success' : 'failure', {
    userId: challenge.id,
    email: challenge.email,
    metadata: {
      recovery_code: usedRecoveryCode,
      ...(sessionResponse.ok ? {} : { reason: 'credential_changed' }),
    },
  });
  return sessionResponse;
}

async function handleTotpVerify(
  request: Request,
  env: AuthEnv,
  expectedRole: AuthRole
) {
  if (request.method !== 'POST') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  const missing = missingAuthConfiguration(env, { totp: true });
  if (missing.length) return configurationError(missing);
  const context = await requestContext(request);
  const coarseLimit = await coarseAuthRateLimit(env, context);
  if (coarseLimit) return coarseLimit;
  const rateLimit = await enforceD1RateLimit(
    env,
    `totp:${context.ipHash}`,
    30,
    10 * 60,
    15 * 60
  );
  if (rateLimit) return rateLimit;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  return body.enrollment_token !== undefined
    ? handleEnrollmentVerification(request, env, body, context, expectedRole)
    : handleLoginVerification(request, env, body, context, expectedRole);
}

async function handleMe(request: Request, env: AuthEnv) {
  if (request.method !== 'GET') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  const missing = missingAuthConfiguration(env);
  if (!missing.length) {
    const session = await loadSession(request, env);
    if (session) {
      const user = await sessionUserPayload(
        env,
        principalFromSession(session.row)
      );
      if (user instanceof Response) return user;
      return authJson({
        data: {
          user,
          expires_at: session.row.expires_at,
          csrf_token: await csrfToken(env, session.token),
        },
      });
    }
  }
  if (missing.length) return configurationError(missing);
  return authError(401, 'authentication_required', '请先登录');
}

async function handlePasswordChange(request: Request, env: AuthEnv, expectedRole: AuthRole) {
  if (request.method !== 'POST') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  const missing = missingAuthConfiguration(env, { password: true });
  if (missing.length) return configurationError(missing);
  const session = await loadSession(request, env);
  if (!session) {
    return authError(401, 'authentication_required', '请先登录');
  }
  if (session.row.role !== expectedRole) {
    return authError(403, 'forbidden', '当前账户无权访问此资源');
  }
  const csrfError = await validateSessionCsrf(request, env, session.token);
  if (csrfError) return csrfError;

  const context = await requestContext(request);
  const coarseLimit = await coarseAuthRateLimit(env, context);
  if (coarseLimit) return coarseLimit;
  const rateLimit = await enforceD1RateLimit(
    env,
    `password-change:${session.row.user_id}`,
    6,
    15 * 60,
    30 * 60
  );
  if (rateLimit) {
    await auditAuth(env, context, 'auth.password_change', 'blocked', {
      userId: session.row.user_id,
      email: session.row.email,
    });
    return rateLimit;
  }

  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = body.new_password;
  if (!currentPassword || currentPassword.length > PASSWORD_MAX_LENGTH) {
    await auditAuth(env, context, 'auth.password_change', 'failure', {
      userId: session.row.user_id,
      email: session.row.email,
      metadata: { reason: 'invalid_current_password' },
    });
    return authError(401, 'invalid_current_password', '当前密码不正确');
  }
  const validationError = passwordValidationError(newPassword);
  if (validationError) {
    await auditAuth(env, context, 'auth.password_change', 'failure', {
      userId: session.row.user_id,
      email: session.row.email,
      metadata: { reason: 'invalid_new_password' },
    });
    return validationError;
  }
  if (currentPassword === newPassword) {
    await auditAuth(env, context, 'auth.password_change', 'failure', {
      userId: session.row.user_id,
      email: session.row.email,
      metadata: { reason: 'password_unchanged' },
    });
    return authError(422, 'password_unchanged', '新密码不能与当前密码相同');
  }

  const user = await env.DB.prepare(
    `SELECT * FROM auth_users WHERE id=? AND email=? AND role=? LIMIT 1`
  )
    .bind(session.row.user_id, session.row.email, session.row.role)
    .first<AuthUserRow>();
  if (!user || !storedPasswordMaterial(user)) {
    await auditAuth(env, context, 'auth.password_change', 'failure', {
      userId: session.row.user_id,
      email: session.row.email,
      metadata: { reason: 'password_change_unavailable' },
    });
    return authError(
      409,
      'password_change_unavailable',
      '当前账户不能在此处修改密码，请联系管理员'
    );
  }
  if (!(await verifyPassword(env, currentPassword, user))) {
    await auditAuth(env, context, 'auth.password_change', 'failure', {
      userId: session.row.user_id,
      email: session.row.email,
      metadata: { reason: 'invalid_current_password' },
    });
    return authError(401, 'invalid_current_password', '当前密码不正确');
  }
  if (await verifyPassword(env, newPassword as string, user)) {
    await auditAuth(env, context, 'auth.password_change', 'failure', {
      userId: user.id,
      email: user.email,
      metadata: { reason: 'password_unchanged' },
    });
    return authError(422, 'password_unchanged', '新密码不能与当前密码相同');
  }
  const stepUpError = await verifyAuthenticatedTotpStepUp(
    request,
    env,
    principalFromSession(session.row),
    body.totp_code,
    'password_change'
  );
  if (stepUpError) return stepUpError;

  const changedAt = nowIso();
  const passwordRecord = await hashPassword(env, newPassword as string);
  const auditId = randomId('aue');
  const emailHash = await sha256(`email:${normalizeEmail(user.email)}`);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_users
         SET password_hash=?, password_salt=?, password_iterations=?,
             password_changed_at=?, failed_password_attempts=0,
             locked_until=NULL, updated_at=?
       WHERE id=? AND status='active'
         AND password_hash=? AND password_salt=? AND password_iterations=?`
    ).bind(
      passwordRecord.hash,
      passwordRecord.salt,
      passwordRecord.iterations,
      changedAt,
      changedAt,
      user.id,
      user.password_hash,
      user.password_salt,
      user.password_iterations
    ),
    env.DB.prepare(
      `UPDATE auth_sessions
         SET revoked_at=?
       WHERE user_id=? AND id<>? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM auth_users
           WHERE id=? AND password_changed_at=? AND password_hash=?
         )`
    ).bind(
      changedAt,
      user.id,
      session.row.session_id,
      user.id,
      changedAt,
      passwordRecord.hash
    ),
    env.DB.prepare(
      `UPDATE auth_login_challenges
         SET consumed_at=?
       WHERE user_id=? AND consumed_at IS NULL
         AND EXISTS (
           SELECT 1 FROM auth_users
           WHERE id=? AND password_changed_at=? AND password_hash=?
         )`
    ).bind(changedAt, user.id, user.id, changedAt, passwordRecord.hash),
    env.DB.prepare(
      `INSERT INTO auth_audit_events
        (id, user_id, email_hash, action, result, ip_hash, user_agent_hash,
         metadata_json, created_at)
       SELECT ?, ?, ?, 'auth.password_change', 'success', ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM auth_users
         WHERE id=? AND password_changed_at=? AND password_hash=?
       )`
    ).bind(
      auditId,
      user.id,
      emailHash,
      context.ipHash,
      context.userAgentHash,
      JSON.stringify({ current_session_preserved: true }),
      changedAt,
      user.id,
      changedAt,
      passwordRecord.hash
    ),
  ]);
  if (results[0].meta.changes !== 1 || results[3].meta.changes !== 1) {
    await auditAuth(env, context, 'auth.password_change', 'failure', {
      userId: user.id,
      email: user.email,
      metadata: { reason: 'state_changed' },
    });
    return authError(409, 'password_change_conflict', '账户状态已变化，请刷新页面后重试');
  }

  return authJson({
    data: {
      password_changed_at: changedAt,
      revoked_sessions: results[1].meta.changes,
    },
  });
}

async function handleLogout(request: Request, env: AuthEnv) {
  if (request.method !== 'POST') {
    return authError(405, 'method_not_allowed', '不支持该请求方法');
  }
  const missing = missingAuthConfiguration(env);
  if (missing.length) return configurationError(missing);
  const session = await loadSession(request, env);
  if (!session) {
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
        'set-cookie': clearSessionCookie(),
      },
    });
  }
  const csrfError = await validateSessionCsrf(request, env, session.token);
  if (csrfError) return csrfError;
  const context = await requestContext(request);
  const revokedAt = nowIso();
  await env.DB.prepare(
    `UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL`
  )
    .bind(revokedAt, session.row.session_id)
    .run();
  await auditAuth(env, context, 'auth.logout', 'success', {
    userId: session.row.user_id,
    email: session.row.email,
  });
  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
      'set-cookie': clearSessionCookie(),
    },
  });
}

export async function handleAuthRequest(
  request: Request,
  env: AuthEnv
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  switch (pathname) {
    case '/api/auth/admin/login':
      return handleLogin(request, env, 'admin');
    case '/api/auth/admin/totp/verify':
      return handleTotpVerify(request, env, 'admin');
    case '/api/auth/admin/totp/setup':
      return handleTotpSetup(request, env, 'admin');
    case '/api/auth/admin/setup/complete':
      return handleSetupComplete(request, env, 'admin');
    case '/api/auth/portal/login':
      return handleLogin(request, env, 'partner');
    case '/api/auth/portal/totp/verify':
      return handleTotpVerify(request, env, 'partner');
    case '/api/auth/portal/totp/setup':
      return handleTotpSetup(request, env, 'partner');
    case '/api/auth/portal/setup/complete':
      return handleSetupComplete(request, env, 'partner');
    case '/api/auth/setup-token':
      return handleSetupToken(request, env);
    case '/api/auth/me':
      return handleMe(request, env);
    case '/api/auth/admin/password/change':
      return handlePasswordChange(request, env, 'admin');
    case '/api/auth/portal/password/change':
      return handlePasswordChange(request, env, 'partner');
    case '/api/auth/logout':
      return handleLogout(request, env);
    default:
      return authError(404, 'not_found', 'API 路径不存在');
  }
}

export async function cleanupExpiredAuthState(env: AuthEnv): Promise<void> {
  const now = nowIso();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const oneYearAgo = new Date(
    Date.now() - 365 * 24 * 60 * 60 * 1000
  ).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM auth_sessions
       WHERE expires_at<? OR idle_expires_at<?
          OR (revoked_at IS NOT NULL AND revoked_at<?)`
    ).bind(now, now, oneDayAgo),
    env.DB.prepare(
      `DELETE FROM auth_login_challenges
       WHERE expires_at<?
          OR (consumed_at IS NOT NULL AND consumed_at<?)`
    ).bind(now, oneDayAgo),
    env.DB.prepare(
      `DELETE FROM auth_totp_enrollments
       WHERE expires_at<?
          OR (verified_at IS NOT NULL AND verified_at<?)`
    ).bind(now, oneDayAgo),
    env.DB.prepare(
      `DELETE FROM auth_setup_tokens
       WHERE expires_at<?
          OR (used_at IS NOT NULL AND used_at<?)`
    ).bind(now, oneDayAgo),
    env.DB.prepare(
      `DELETE FROM auth_rate_limits WHERE updated_at<?`
    ).bind(oneDayAgo),
    env.DB.prepare(
      `DELETE FROM auth_audit_events WHERE created_at<?`
    ).bind(oneYearAgo),
  ]);
}

export function rewriteBrowserApiRequest(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api\/browser\/v1\//, '/api/v1/');
  return new Request(url.toString(), request);
}
