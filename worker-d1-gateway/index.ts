type D1Value = string | number | null;

type StatementRequest = {
  sql: string;
  params?: D1Value[];
};

type GatewayRequest = {
  statements: StatementRequest[];
};

const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_STATEMENTS = 64;
const MAX_SQL_BYTES = 32 * 1024;

function normalizeSQL(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ').toUpperCase();
}

const ALLOWED_WRITE_SQL = new Set(
  [
    `INSERT OR IGNORE INTO cregis_wallets
      (id, tenant_id, customer_id, idempotency_key, chain_id, token_id, currency, alias, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?)`,
    `UPDATE cregis_wallets SET status='error', updated_at=? WHERE id=? AND status='creating'`,
    `UPDATE cregis_wallets
      SET address=?, custody_provider='cregis', ownership_verified_at=?, status='active', updated_at=?
      WHERE id=? AND tenant_id=? AND status='creating'`,
    `UPDATE cregis_wallets
      SET address=?, status='error', updated_at=? WHERE id=? AND tenant_id=? AND status='creating'`,
    `INSERT OR IGNORE INTO cregis_withdrawals
      (id, tenant_id, customer_id, wallet_id, idempotency_key, third_party_id, currency, amount_text, amount_minor,
       from_address, to_address, memo, remark, status, maker_id, created_at, updated_at)
      SELECT ?, ?, ?, w.id, ?, ?, ?, ?, ?, w.address, ?, ?, ?, 'submitted', ?, ?, ?
      FROM cregis_wallets w JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id
      WHERE w.id=? AND w.tenant_id=? AND w.customer_id=? AND w.chain_id=? AND w.token_id=? AND w.currency=?
        AND w.status='active' AND w.custody_provider='cregis' AND w.ownership_verified_at IS NOT NULL
        AND c.status='active' AND c.kyc_status='approved' AND c.operations_status='active'
        AND ? <= COALESCE((SELECT SUM(d.amount_minor) FROM cregis_deposits d
          WHERE d.tenant_id=w.tenant_id AND d.wallet_id=w.id AND d.status='completed'), 0)
          - COALESCE((SELECT SUM(x.amount_minor) FROM cregis_withdrawals x
            WHERE x.tenant_id=w.tenant_id AND x.wallet_id=w.id AND x.customer_id=c.id
              AND x.status NOT IN ('rejected', 'failed', 'cancelled')), 0)`,
    `UPDATE cregis_withdrawals
      SET status='approved', checker_id=?, approved_at=?, updated_at=?
      WHERE id=? AND tenant_id=? AND status='submitted'`,
    `UPDATE cregis_withdrawals
      SET status='rejected', checker_id=?, rejection_reason=?, updated_at=?
      WHERE id=? AND tenant_id=? AND status='submitted'`,
    `UPDATE cregis_withdrawals SET status='executing', operator_id=?, updated_at=?
      WHERE id=? AND tenant_id=? AND status='approved' AND checker_id IS NOT NULL`,
    `UPDATE cregis_withdrawals SET status='failed', updated_at=? WHERE id=? AND status='executing'`,
    `UPDATE cregis_withdrawals SET status='exception', updated_at=? WHERE id=? AND status='executing'`,
    `UPDATE cregis_withdrawals
      SET status='submitted_to_cregis', cregis_cid=?, submitted_at=?, updated_at=?
      WHERE id=? AND status='executing'`,
    `UPDATE cregis_withdrawals
      SET status='submitted_to_cregis', cregis_cid=?, reconciliation_note=?, reconciled_by=?, reconciled_at=?, updated_at=?
      WHERE id=? AND tenant_id=? AND status='exception'`,
    `UPDATE cregis_withdrawals
      SET status='failed', reconciliation_note=?, reconciled_by=?, reconciled_at=?, updated_at=?
      WHERE id=? AND tenant_id=? AND status='exception'`,
    `UPDATE cregis_withdrawals
      SET status='cancelled', reconciliation_note=?, reconciled_by=?, reconciled_at=?, updated_at=?
      WHERE id=? AND tenant_id=? AND status='exception'`,
    `INSERT OR IGNORE INTO cregis_callback_events
      (id, event_type, cregis_cid, status, payload_sha256, received_at) VALUES (?, 'deposit', ?, ?, ?, ?)`,
    `INSERT OR IGNORE INTO cregis_deposits
      (id, tenant_id, wallet_id, cregis_cid, chain_id, token_id, currency, address, amount_text, amount_minor,
       status, txid, block_height, block_time, received_at, raw_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `INSERT OR IGNORE INTO cregis_callback_events
      (id, event_type, cregis_cid, status, payload_sha256, received_at) VALUES (?, 'payout', ?, ?, ?, ?)`,
    `UPDATE cregis_withdrawals SET status='submitted_to_cregis', cregis_cid=?, submitted_at=COALESCE(submitted_at, ?), updated_at=?
      WHERE tenant_id=? AND third_party_id=? AND status IN ('executing', 'exception')`,
    `UPDATE cregis_withdrawals SET status=?, cregis_cid=?, txid=?, block_height=?, block_time=?, completed_at=?, updated_at=?
      WHERE tenant_id=? AND third_party_id=? AND status='submitted_to_cregis'`,
    `INSERT OR IGNORE INTO customers
      (id, tenant_id, email, display_name, status, kyc_status, operations_status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending_setup', 'pending', 'pending', ?, ?, ?)`,
    `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at)
      SELECT ?, ?, 'customer.created', ?, '{}', ?
      WHERE EXISTS (SELECT 1 FROM customers WHERE id=? AND tenant_id=? AND kyc_status='pending' AND operations_status='pending')`,
    `UPDATE customer_credentials
      SET password_salt=?, password_hash=?, password_iterations=?, totp_secret_ciphertext=?,
          setup_consumed_at=?, enrollment_token_hash=?, enrollment_expires_at=?, updated_at=?
      WHERE customer_id=? AND setup_token_hash=? AND setup_consumed_at IS NULL AND setup_expires_at>?`,
    `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at)
      SELECT ?, ?, 'auth.password_enrolled', ?, '{}', ?
      WHERE EXISTS (SELECT 1 FROM customer_credentials WHERE customer_id=? AND enrollment_token_hash=?)`,
    `UPDATE customer_credentials SET failed_attempts=?, locked_until=?, updated_at=?
      WHERE customer_id=?`,
    `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'auth.login_failed', ?, '{}', ?)`,
    `UPDATE customer_credentials SET failed_attempts=0, locked_until=NULL, updated_at=?
      WHERE customer_id=?`,
    `INSERT INTO customer_login_challenges
      (id, customer_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    `UPDATE customers SET status='active', updated_at=?
      WHERE id=? AND tenant_id=? AND status='pending_setup' AND kyc_status='approved' AND operations_status='active'`,
    `UPDATE customer_credentials
      SET setup_token_hash=NULL, setup_expires_at=NULL, enrollment_token_hash=NULL, enrollment_expires_at=NULL, updated_at=?
      WHERE customer_id=? AND enrollment_token_hash=?`,
    `INSERT INTO customer_recovery_codes
      (id, customer_id, code_hash, created_at) VALUES (?, ?, ?, ?)`,
    `UPDATE customer_login_challenges SET consumed_at=?
      WHERE id=? AND consumed_at IS NULL`,
    `UPDATE customer_recovery_codes SET used_at=?
      WHERE id=? AND customer_id=? AND used_at IS NULL`,
    `INSERT INTO customer_sessions
      (id, customer_id, token_hash, csrf_hash, credential_version, expires_at, created_at, last_seen_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM customer_recovery_codes WHERE id=? AND customer_id=? AND used_at=?)`,
    `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at)
      SELECT ?, ?, 'auth.login_succeeded', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM customer_sessions WHERE id=? AND customer_id=?)`,
    `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
      WHERE id=? AND revoked_at IS NULL`,
    `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'auth.logout', ?, '{}', ?)`,
    `INSERT INTO customer_sessions
      (id, customer_id, token_hash, csrf_hash, credential_version, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `UPDATE customers
      SET kyc_status=?, kyc_reviewed_by=?, kyc_reviewed_at=?, kyc_review_note=?, updated_at=?
      WHERE id=? AND tenant_id=? AND kyc_status='pending' AND operations_status='pending'`,
    `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at)
      SELECT ?, ?, 'customer.kyc_reviewed', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM customers
        WHERE id=? AND tenant_id=? AND kyc_reviewed_by=? AND kyc_reviewed_at=?)`,
    `UPDATE customers
      SET operations_status='active', activated_by=?, activated_at=?, updated_at=?
      WHERE id=? AND tenant_id=? AND kyc_status='approved' AND operations_status='pending'
        AND status IN ('pending_setup', 'active')`,
    `INSERT INTO customer_credentials
      (customer_id, password_iterations, setup_token_hash, setup_expires_at, updated_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM customers
        WHERE id=? AND tenant_id=? AND status='pending_setup' AND kyc_status='approved'
          AND operations_status='active' AND activated_by=? AND activated_at=?)
      ON CONFLICT(customer_id) DO UPDATE SET
        password_iterations=excluded.password_iterations,
        setup_token_hash=excluded.setup_token_hash,
        setup_expires_at=excluded.setup_expires_at,
        setup_consumed_at=NULL,
        enrollment_token_hash=NULL,
        enrollment_expires_at=NULL,
        updated_at=excluded.updated_at`,
    `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at)
      SELECT ?, ?, 'customer.operations_activated', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM customers
        WHERE id=? AND tenant_id=? AND operations_status='active' AND activated_by=? AND activated_at=?)`,
  ].map(normalizeSQL)
);

function json(data: unknown, status = 200, requestId?: string): Response {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
  });
}

function parseHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function authorize(request: Request, rawBody: string, env: Env): Promise<boolean> {
  const timestampValue = request.headers.get('x-neobank-timestamp')?.trim() || '';
  const signatureValue = request.headers.get('x-neobank-signature')?.trim() || '';
  const timestamp = Number(timestampValue);
  const signature = parseHex(signatureValue);
  if (!Number.isInteger(timestamp) || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.GO_D1_GATEWAY_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(`${timestampValue}.${rawBody}`)
  );
}

function validStatement(statement: StatementRequest): boolean {
  const sql = statement.sql.trim();
  if (!sql || new TextEncoder().encode(sql).byteLength > MAX_SQL_BYTES) return false;
  if (sql.includes(';')) return false;
  if (!/^(SELECT|INSERT|UPDATE|WITH)\b/i.test(sql)) return false;
  if (/\b(PRAGMA|ATTACH|DETACH|VACUUM|CREATE|ALTER|DROP|REINDEX)\b/i.test(sql)) return false;
  const normalized = normalizeSQL(sql);
  if (/^(INSERT|UPDATE)\b/.test(normalized) && !ALLOWED_WRITE_SQL.has(normalized)) return false;
  if (/^WITH\b/.test(normalized) && /\b(INSERT|UPDATE|DELETE|REPLACE)\b/.test(normalized)) {
    return false;
  }
  return (statement.params || []).every(
    (value) => value === null || typeof value === 'string' || typeof value === 'number'
  );
}

async function handleQuery(request: Request, env: Env, requestId: string): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: { code: 'payload_too_large' } }, 413, requestId);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: { code: 'payload_too_large' } }, 413, requestId);
  }
  if (!(await authorize(request, rawBody, env))) {
    return json({ error: { code: 'unauthorized' } }, 401, requestId);
  }

  let payload: GatewayRequest;
  try {
    payload = JSON.parse(rawBody) as GatewayRequest;
  } catch {
    return json({ error: { code: 'invalid_json' } }, 400, requestId);
  }
  if (
    !Array.isArray(payload.statements) ||
    payload.statements.length < 1 ||
    payload.statements.length > MAX_STATEMENTS ||
    !payload.statements.every(validStatement)
  ) {
    return json({ error: { code: 'invalid_statements' } }, 422, requestId);
  }

  const prepared = payload.statements.map((statement) => {
    const query = env.DB.prepare(statement.sql);
    return statement.params?.length ? query.bind(...statement.params) : query;
  });
  const results = await env.DB.batch(prepared);
  return json({ results }, 200, requestId);
}

export default {
  async fetch(request, env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    try {
      if (url.pathname === '/healthz' && request.method === 'GET') {
        return json({ status: 'ok', service: 'neobank-d1-gateway' }, 200, requestId);
      }
      if (url.pathname === '/internal/d1/query' && request.method === 'POST') {
        return await handleQuery(request, env, requestId);
      }
      return json({ error: { code: 'not_found' } }, 404, requestId);
    } catch (caught) {
      console.error(
        JSON.stringify({
          event: 'd1_gateway_error',
          request_id: requestId,
          message: caught instanceof Error ? caught.message : 'unknown_error',
        })
      );
      return json({ error: { code: 'internal_error' } }, 500, requestId);
    }
  },
} satisfies ExportedHandler<Env>;
