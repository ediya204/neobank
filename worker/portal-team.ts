export const PORTAL_TEAM_API_PREFIX = '/api/v1/portal/team';
export const PORTAL_TEAM_BOOTSTRAP_PARTNER_KEY = 'ethan';
export const PORTAL_TEAM_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const PORTAL_TEAM_PERMISSION_KEYS = [
  'team.read',
  'team.invite',
  'team.manage_members',
  'team.manage_roles',
  'customers.read',
  'customers.create',
  'transactions.read',
  'balances.read',
  'integrations.read',
  'integrations.request_change',
  'credentials.reveal',
  'notifications.read',
] as const;

export type PortalTeamPermission = typeof PORTAL_TEAM_PERMISSION_KEYS[number];
export type PortalTeamRoleCode =
  | 'owner'
  | 'admin'
  | 'operations'
  | 'developer'
  | 'viewer'
  | string;
export type PortalTeamMemberStatus = 'onboarding' | 'active' | 'suspended';
export type PortalTeamInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'expired';
export type PortalTeamAuditTarget =
  | 'organization'
  | 'member'
  | 'invitation'
  | 'role';

export type PortalTeamEnv = {
  DB: D1Database;
  AUTH_PARTNER_EMAIL?: string;
  AUTH_LOCAL_BYPASS?: string;
};

// This deliberately uses structural typing and does not import auth.ts at
// runtime. AuthPrincipal can be passed directly without creating a cycle.
export type PortalTeamBasePrincipal = {
  userId: string;
  email: string;
  role: 'admin' | 'partner';
  sessionId: string | null;
  expiresAt: string | null;
  via: 'session';
};

export type PortalTeamPrincipal = PortalTeamBasePrincipal & {
  organizationId: string;
  partnerKey: string;
  organizationName: string;
  membershipVersion: number;
  roleId: string;
  roleCode: PortalTeamRoleCode;
  roleName: string;
  isOwner: boolean;
  permissions: PortalTeamPermission[];
};

type MembershipResolutionRow = {
  organization_id: string;
  partner_key: string;
  organization_name: string;
  organization_status: 'active' | 'suspended';
  member_status: PortalTeamMemberStatus;
  member_version: number;
  role_id: string;
  role_code: string;
  role_name: string;
  is_owner: number;
  user_email: string;
  user_role: 'admin' | 'partner';
  user_status: 'active' | 'disabled';
};

type PortalMemberRow = {
  user_id: string;
  email: string;
  display_name: string | null;
  status: PortalTeamMemberStatus;
  version: number;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  role_id: string;
  role_code: string;
  role_name: string;
  role_is_owner: number;
};

type PortalInvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role_id: string;
  token_hash: string;
  setup_token_id: string | null;
  status: PortalTeamInvitationStatus;
  expires_at: string;
  invited_by_user_id: string;
  revoked_by_user_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  role_code: string;
  role_name: string;
  role_is_owner: number;
};

type PortalRoleRow = {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  description: string;
  is_system: number;
  is_owner: number;
  version: number;
  created_at: string;
  updated_at: string;
  member_count: number;
};

type PortalPermissionRow = {
  key: string;
  category: string;
  risk_level: 'standard' | 'restricted';
  description: string;
};

type PortalInvitationEnrollmentRow = {
  invitation_id: string;
  organization_id: string;
  email: string;
  role_id: string;
  invited_by_user_id: string;
  expires_at: string;
  setup_token_id: string | null;
  setup_token_hash: string | null;
  setup_token_expires_at: string | null;
  setup_token_used_at: string | null;
  user_id: string | null;
  user_role: 'admin' | 'partner' | null;
  user_status: 'active' | 'disabled' | null;
  setup_completed_at: string | null;
  member_organization_id: string | null;
  member_status: PortalTeamMemberStatus | null;
};

type ExpirablePortalInvitation = {
  invitation_id: string;
  organization_id: string;
  email: string;
  invited_by_user_id: string;
  setup_token_id: string | null;
};

const PORTAL_TEAM_JSON_MAX_BYTES = 16_384;
const PORTAL_TEAM_PERMISSION_SET = new Set<string>(PORTAL_TEAM_PERMISSION_KEYS);
const textEncoder = new TextEncoder();

function portalTeamJson(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function portalTeamError(
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  return portalTeamJson(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    status
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readPortalTeamJson(
  request: Request
): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > PORTAL_TEAM_JSON_MAX_BYTES) {
    return portalTeamError(413, 'payload_too_large', '请求内容不能超过 16 KB');
  }
  try {
    const text = await request.text();
    if (textEncoder.encode(text).byteLength > PORTAL_TEAM_JSON_MAX_BYTES) {
      return portalTeamError(413, 'payload_too_large', '请求内容不能超过 16 KB');
    }
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed)
      ? parsed
      : portalTeamError(400, 'invalid_json', '请求内容必须是 JSON 对象');
  } catch {
    return portalTeamError(400, 'invalid_json', '无法解析 JSON 请求内容');
  }
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[]
) {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key)).sort();
  return unknown.length
    ? portalTeamError(422, 'unknown_fields', '请求包含不受支持的字段', {
        fields: unknown,
      })
    : null;
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

function normalizeRoleCode(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    : '';
}

function validRoleCode(value: string) {
  return /^[a-z][a-z0-9_]{1,49}$/.test(value);
}

function isPortalTeamPermission(value: string): value is PortalTeamPermission {
  return PORTAL_TEAM_PERMISSION_SET.has(value);
}

function nowIso() {
  return new Date().toISOString();
}

function invitationExpiryIso() {
  return new Date(
    Date.now() + PORTAL_TEAM_INVITATION_TTL_SECONDS * 1000
  ).toISOString();
}

function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function randomInvitationToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function hashPortalAuthSetupToken(token: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(`setup:${token}`)
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashPortalInvitationToken(token: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(`portal-invitation:${token}`)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function auditStatement(
  env: PortalTeamEnv,
  options: {
    organizationId: string;
    actorUserId: string;
    action: string;
    targetType: PortalTeamAuditTarget;
    targetId: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }
) {
  return env.DB.prepare(
    `INSERT INTO portal_team_audit_events
      (id,organization_id,actor_user_id,action,target_type,target_id,
       metadata_json,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    randomId('pta'),
    options.organizationId,
    options.actorUserId,
    options.action,
    options.targetType,
    options.targetId,
    JSON.stringify(options.metadata || {}),
    options.createdAt
  );
}

export async function writePortalTeamAudit(
  env: PortalTeamEnv,
  options: {
    organizationId: string;
    actorUserId: string;
    action: string;
    targetType: PortalTeamAuditTarget;
    targetId: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }
) {
  await auditStatement(env, {
    ...options,
    createdAt: options.createdAt || nowIso(),
  }).run();
}

export async function ensurePortalOwnerMembership(
  env: PortalTeamEnv,
  principal: PortalTeamBasePrincipal
): Promise<boolean> {
  if (principal.role !== 'partner') return false;
  const normalizedEmail = principal.email.trim().toLowerCase();
  const configuredPartnerEmail = env.AUTH_PARTNER_EMAIL?.trim().toLowerCase() || '';
  const productionBootstrapAllowed =
    Boolean(configuredPartnerEmail) && normalizedEmail === configuredPartnerEmail;
  const localBootstrapAllowed =
    String(env.AUTH_LOCAL_BYPASS).toLowerCase() === 'true' &&
    principal.userId === 'usr_local_portal';
  if (!productionBootstrapAllowed && !localBootstrapAllowed) return false;
  const createdAt = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO portal_organization_members
        (organization_id,user_id,role_id,display_name,status,version,
         invited_by_user_id,joined_at,created_at,updated_at)
       SELECT o.id,u.id,r.id,NULL,'active',1,NULL,?,?,?
       FROM auth_users u
       JOIN portal_organizations o ON o.partner_key=? AND o.status='active'
       JOIN portal_roles r
         ON r.organization_id=o.id AND r.is_owner=1
       WHERE u.id=? AND u.email=? AND u.role='partner' AND u.status='active'
         AND NOT EXISTS (
           SELECT 1 FROM portal_organization_members existing_user
           WHERE existing_user.user_id=u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM portal_organization_members existing_org
           WHERE existing_org.organization_id=o.id
         )`
    ).bind(
      createdAt,
      createdAt,
      createdAt,
      PORTAL_TEAM_BOOTSTRAP_PARTNER_KEY,
      principal.userId,
      normalizedEmail
    ),
    env.DB.prepare(
      `INSERT INTO portal_team_audit_events
        (id,organization_id,actor_user_id,action,target_type,target_id,
         metadata_json,created_at)
       SELECT ?,m.organization_id,m.user_id,'team.owner_bootstrapped','member',
         m.user_id,?,?
       FROM portal_organization_members m
       JOIN portal_roles r
         ON r.id=m.role_id AND r.organization_id=m.organization_id
       WHERE m.user_id=? AND m.created_at=? AND r.is_owner=1`
    ).bind(
      randomId('pta'),
      JSON.stringify({ partner_key: PORTAL_TEAM_BOOTSTRAP_PARTNER_KEY }),
      createdAt,
      principal.userId,
      createdAt
    ),
  ]);
  return results[0].meta.changes === 1;
}

export async function resolvePortalTeamPrincipal(
  env: PortalTeamEnv,
  principal: PortalTeamBasePrincipal
): Promise<PortalTeamPrincipal | Response> {
  if (principal.role !== 'partner') {
    return portalTeamError(403, 'portal_principal_required', '仅 Partner Portal 成员可访问团队资源');
  }

  await ensurePortalOwnerMembership(env, principal);
  const membership = await env.DB.prepare(
    `SELECT
       m.organization_id,
       o.partner_key,
       o.name AS organization_name,
       o.status AS organization_status,
       m.status AS member_status,
       m.version AS member_version,
       r.id AS role_id,
       r.code AS role_code,
       r.name AS role_name,
       r.is_owner,
       u.email AS user_email,
       u.role AS user_role,
       u.status AS user_status
     FROM portal_organization_members m
     JOIN portal_organizations o ON o.id=m.organization_id
     JOIN portal_roles r
       ON r.id=m.role_id AND r.organization_id=m.organization_id
     JOIN auth_users u ON u.id=m.user_id
     WHERE m.user_id=?
     LIMIT 1`
  )
    .bind(principal.userId)
    .first<MembershipResolutionRow>();

  if (!membership) {
    return portalTeamError(403, 'portal_membership_required', '当前账户尚未加入 Partner 组织');
  }
  if (
    membership.user_role !== 'partner' ||
    membership.user_status !== 'active' ||
    membership.user_email.toLowerCase() !== principal.email.trim().toLowerCase()
  ) {
    return portalTeamError(403, 'portal_identity_conflict', 'Portal 身份与成员记录不一致');
  }
  if (membership.organization_status !== 'active') {
    return portalTeamError(403, 'portal_organization_suspended', 'Partner 组织已停用');
  }
  if (membership.member_status !== 'active') {
    return portalTeamError(
      403,
      membership.member_status === 'onboarding'
        ? 'portal_membership_onboarding'
        : 'portal_membership_suspended',
      membership.member_status === 'onboarding'
        ? '成员激活流程尚未完成'
        : '当前成员已停用'
    );
  }

  const permissionRows = await env.DB.prepare(
    `SELECT rp.permission_key
     FROM portal_role_permissions rp
     JOIN portal_permissions p ON p.key=rp.permission_key
     WHERE rp.role_id=?
     ORDER BY rp.permission_key`
  )
    .bind(membership.role_id)
    .all<{ permission_key: string }>();
  const permissions = permissionRows.results
    .map((row) => row.permission_key)
    .filter(isPortalTeamPermission);

  return {
    ...principal,
    organizationId: membership.organization_id,
    partnerKey: membership.partner_key,
    organizationName: membership.organization_name,
    membershipVersion: membership.member_version,
    roleId: membership.role_id,
    roleCode: membership.role_code,
    roleName: membership.role_name,
    isOwner: membership.is_owner === 1,
    permissions,
  };
}

export function requirePortalTeamPermission(
  principal: PortalTeamPrincipal,
  permission: PortalTeamPermission
): Response | null {
  return principal.permissions.includes(permission)
    ? null
    : portalTeamError(403, 'missing_permission', '当前角色无权执行此操作', {
        permission,
      });
}

function normalizeMember(row: PortalMemberRow, currentUserId: string) {
  return {
    id: row.user_id,
    user_id: row.user_id,
    email: row.email,
    display_name: row.display_name,
    status: row.status,
    version: row.version,
    joined_at: row.joined_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    is_current_user: row.user_id === currentUserId,
    role: {
      id: row.role_id,
      code: row.role_code,
      name: row.role_name,
      is_owner: row.role_is_owner === 1,
    },
  };
}

function effectiveInvitationStatus(
  row: PortalInvitationRow
): PortalTeamInvitationStatus {
  return row.status === 'pending' && Date.parse(row.expires_at) <= Date.now()
    ? 'expired'
    : row.status;
}

function normalizeInvitation(row: PortalInvitationRow) {
  return {
    id: row.id,
    email: row.email,
    status: effectiveInvitationStatus(row),
    expires_at: row.expires_at,
    invited_by_user_id: row.invited_by_user_id,
    accepted_by_user_id: row.accepted_by_user_id,
    accepted_at: row.accepted_at,
    revoked_by_user_id: row.revoked_by_user_id,
    revoked_at: row.revoked_at,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    role: {
      id: row.role_id,
      code: row.role_code,
      name: row.role_name,
      is_owner: row.role_is_owner === 1,
    },
  };
}

export async function listPortalTeamMembers(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal
) {
  const permissionError = requirePortalTeamPermission(principal, 'team.read');
  if (permissionError) return permissionError;
  const rows = await env.DB.prepare(
    `SELECT
       m.user_id,u.email,m.display_name,m.status,m.version,m.joined_at,
       m.created_at,m.updated_at,u.last_login_at,
       r.id AS role_id,r.code AS role_code,r.name AS role_name,
       r.is_owner AS role_is_owner
     FROM portal_organization_members m
     JOIN auth_users u ON u.id=m.user_id
     JOIN portal_roles r
       ON r.id=m.role_id AND r.organization_id=m.organization_id
     WHERE m.organization_id=?
     ORDER BY r.is_owner DESC,r.name COLLATE NOCASE,u.email COLLATE NOCASE`
  )
    .bind(principal.organizationId)
    .all<PortalMemberRow>();
  return portalTeamJson({
    data: rows.results.map((row) => normalizeMember(row, principal.userId)),
    meta: {
      count: rows.results.length,
      current_user: {
        user_id: principal.userId,
        role_code: principal.roleCode,
        permissions: principal.permissions,
      },
    },
  });
}

export async function listPortalTeamInvitations(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal
) {
  const permissionError = requirePortalTeamPermission(principal, 'team.read');
  if (permissionError) return permissionError;
  const rows = await env.DB.prepare(
    `SELECT
       i.*,r.code AS role_code,r.name AS role_name,r.is_owner AS role_is_owner
     FROM portal_invitations i
     JOIN portal_roles r
       ON r.id=i.role_id AND r.organization_id=i.organization_id
     WHERE i.organization_id=?
     ORDER BY i.created_at DESC
     LIMIT 200`
  )
    .bind(principal.organizationId)
    .all<PortalInvitationRow>();
  return portalTeamJson({
    data: rows.results.map(normalizeInvitation),
    meta: { count: rows.results.length },
  });
}

export async function listPortalTeamRoles(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal
) {
  const permissionError = requirePortalTeamPermission(principal, 'team.read');
  if (permissionError) return permissionError;
  const [roles, rolePermissions, catalog] = await Promise.all([
    env.DB.prepare(
      `SELECT
         r.*,
         COUNT(m.user_id) AS member_count
       FROM portal_roles r
       LEFT JOIN portal_organization_members m
         ON m.role_id=r.id AND m.organization_id=r.organization_id
       WHERE r.organization_id=?
       GROUP BY r.id
       ORDER BY r.is_owner DESC,r.is_system DESC,r.name COLLATE NOCASE`
    )
      .bind(principal.organizationId)
      .all<PortalRoleRow>(),
    env.DB.prepare(
      `SELECT rp.role_id,rp.permission_key
       FROM portal_role_permissions rp
       JOIN portal_roles r ON r.id=rp.role_id
       WHERE r.organization_id=?
       ORDER BY rp.role_id,rp.permission_key`
    )
      .bind(principal.organizationId)
      .all<{ role_id: string; permission_key: string }>(),
    env.DB.prepare(
      `SELECT key,category,risk_level,description
       FROM portal_permissions ORDER BY category,key`
    ).all<PortalPermissionRow>(),
  ]);
  const permissionsByRole = new Map<string, PortalTeamPermission[]>();
  for (const item of rolePermissions.results) {
    if (!isPortalTeamPermission(item.permission_key)) continue;
    const permissions = permissionsByRole.get(item.role_id) || [];
    permissions.push(item.permission_key);
    permissionsByRole.set(item.role_id, permissions);
  }
  return portalTeamJson({
    data: roles.results.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      is_system: role.is_system === 1,
      is_owner: role.is_owner === 1,
      version: role.version,
      permissions: permissionsByRole.get(role.id) || [],
      member_count: Number(role.member_count || 0),
      assignable:
        role.is_owner !== 1 &&
        (principal.isOwner || !(role.is_system === 1 && role.code === 'admin')) &&
        (permissionsByRole.get(role.id) || []).every((permission) =>
          principal.permissions.includes(permission)
        ),
      created_at: role.created_at,
      updated_at: role.updated_at,
    })),
    meta: {
      count: roles.results.length,
      permission_catalog: catalog.results,
    },
  });
}

function guardedAuditStatement(
  env: PortalTeamEnv,
  options: {
    organizationId: string;
    actorUserId: string;
    action: string;
    targetType: PortalTeamAuditTarget;
    targetId: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
    sourceTable:
      | 'portal_invitations'
      | 'portal_organization_members'
      | 'portal_roles';
    sourceIdColumn: 'id' | 'user_id';
    sourceId: string;
  }
) {
  return env.DB.prepare(
    `INSERT INTO portal_team_audit_events
      (id,organization_id,actor_user_id,action,target_type,target_id,
       metadata_json,created_at)
     SELECT ?,?,?,?,?,?,?,?
     WHERE EXISTS (
       SELECT 1 FROM ${options.sourceTable}
       WHERE organization_id=? AND ${options.sourceIdColumn}=? AND updated_at=?
     )`
  ).bind(
    randomId('pta'),
    options.organizationId,
    options.actorUserId,
    options.action,
    options.targetType,
    options.targetId,
    JSON.stringify(options.metadata || {}),
    options.createdAt,
    options.organizationId,
    options.sourceId,
    options.createdAt
  );
}

async function loadPortalRole(
  env: PortalTeamEnv,
  organizationId: string,
  roleId: string
) {
  return env.DB.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM portal_organization_members m
        WHERE m.organization_id=r.organization_id AND m.role_id=r.id) member_count
     FROM portal_roles r
     WHERE r.id=? AND r.organization_id=?`
  )
    .bind(roleId, organizationId)
    .first<PortalRoleRow>();
}

async function loadPortalRolePermissions(
  env: PortalTeamEnv,
  organizationId: string,
  roleId: string
) {
  const rows = await env.DB.prepare(
    `SELECT rp.permission_key
     FROM portal_role_permissions rp
     JOIN portal_roles r
       ON r.id=rp.role_id AND r.organization_id=?
     WHERE rp.role_id=?
     ORDER BY rp.permission_key`
  )
    .bind(organizationId, roleId)
    .all<{ permission_key: string }>();
  return rows.results
    .map((row) => row.permission_key)
    .filter(isPortalTeamPermission);
}

async function loadPortalMember(
  env: PortalTeamEnv,
  organizationId: string,
  userId: string
) {
  return env.DB.prepare(
    `SELECT
       m.user_id,u.email,m.display_name,m.status,m.version,m.joined_at,
       m.created_at,m.updated_at,u.last_login_at,
       r.id AS role_id,r.code AS role_code,r.name AS role_name,
       r.is_owner AS role_is_owner
     FROM portal_organization_members m
     JOIN auth_users u ON u.id=m.user_id
     JOIN portal_roles r
       ON r.id=m.role_id AND r.organization_id=m.organization_id
     WHERE m.organization_id=? AND m.user_id=?`
  )
    .bind(organizationId, userId)
    .first<PortalMemberRow>();
}

async function loadPortalInvitation(
  env: PortalTeamEnv,
  organizationId: string,
  invitationId: string
) {
  return env.DB.prepare(
    `SELECT
       i.*,r.code AS role_code,r.name AS role_name,r.is_owner AS role_is_owner
     FROM portal_invitations i
     JOIN portal_roles r
       ON r.id=i.role_id AND r.organization_id=i.organization_id
     WHERE i.id=? AND i.organization_id=?`
  )
    .bind(invitationId, organizationId)
    .first<PortalInvitationRow>();
}

async function expirePortalInvitationEnrollment(
  env: PortalTeamEnv,
  invitation: ExpirablePortalInvitation,
  expiredAt: string
) {
  const setupTokenId = invitation.setup_token_id || '';
  const auditId = randomId('pta');
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE portal_invitations
       SET status='expired',version=version+1,updated_at=?
       WHERE id=? AND organization_id=? AND status='pending' AND expires_at<=?`
    ).bind(
      expiredAt,
      invitation.invitation_id,
      invitation.organization_id,
      expiredAt
    ),
    env.DB.prepare(
      `INSERT INTO portal_team_audit_events
        (id,organization_id,actor_user_id,action,target_type,target_id,
         metadata_json,created_at)
       SELECT ?,?,?,?,?,?,?,?
       WHERE changes()=1`
    ).bind(
      auditId,
      invitation.organization_id,
      invitation.invited_by_user_id,
      'team.invitation_expired',
      'invitation',
      invitation.invitation_id,
      JSON.stringify({ email: invitation.email, reason: 'ttl_elapsed' }),
      expiredAt
    ),
    env.DB.prepare(
      `UPDATE auth_setup_tokens SET used_at=?
       WHERE id=? AND used_at IS NULL
         AND EXISTS (
           SELECT 1 FROM portal_team_audit_events e
           WHERE e.id=? AND e.organization_id=?
             AND e.action='team.invitation_expired' AND e.target_id=?
         )`
    ).bind(
      expiredAt,
      setupTokenId,
      auditId,
      invitation.organization_id,
      invitation.invitation_id
    ),
    env.DB.prepare(
      `DELETE FROM portal_organization_members
       WHERE organization_id=? AND status='onboarding'
         AND user_id=(SELECT user_id FROM auth_setup_tokens WHERE id=?)
         AND EXISTS (
           SELECT 1 FROM portal_team_audit_events e
           WHERE e.id=? AND e.organization_id=?
             AND e.action='team.invitation_expired' AND e.target_id=?
         )`
    ).bind(
      invitation.organization_id,
      setupTokenId,
      auditId,
      invitation.organization_id,
      invitation.invitation_id
    ),
    env.DB.prepare(
      `DELETE FROM auth_users
       WHERE id=(SELECT user_id FROM auth_setup_tokens WHERE id=?)
         AND setup_completed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM portal_organization_members m
           WHERE m.user_id=auth_users.id
         )
         AND EXISTS (
           SELECT 1 FROM portal_team_audit_events e
           WHERE e.id=? AND e.organization_id=?
             AND e.action='team.invitation_expired' AND e.target_id=?
         )`
    ).bind(
      setupTokenId,
      auditId,
      invitation.organization_id,
      invitation.invitation_id
    ),
  ]);
  return results[0].meta.changes === 1;
}

export async function createPortalTeamInvitation(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal,
  request: Request
) {
  const permissionError = requirePortalTeamPermission(principal, 'team.invite');
  if (permissionError) return permissionError;
  const body = await readPortalTeamJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['email', 'role_id']);
  if (unknownFields) return unknownFields;
  const email = normalizeEmail(body.email);
  const roleId = typeof body.role_id === 'string' ? body.role_id.trim() : '';
  if (!isEmail(email) || !roleId) {
    return portalTeamError(422, 'validation_error', '请提供有效的 email 和 role_id');
  }
  const role = await loadPortalRole(env, principal.organizationId, roleId);
  if (!role) return portalTeamError(404, 'role_not_found', '角色不存在');
  if (role.is_owner === 1) {
    return portalTeamError(
      409,
      'owner_transfer_required',
      'Owner 角色只能通过独立的所有权转移流程授予'
    );
  }
  if (!principal.isOwner && role.is_system === 1 && role.code === 'admin') {
    return portalTeamError(403, 'owner_required_for_admin_role', '仅 Owner 可授予 Admin 角色');
  }
  const rolePermissions = await loadPortalRolePermissions(
    env,
    principal.organizationId,
    role.id
  );
  const delegationError = validateDelegatedPermissions(principal, rolePermissions);
  if (delegationError) return delegationError;
  const createdAt = nowIso();
  const expiredInvitation = await env.DB.prepare(
    `SELECT
       id AS invitation_id,organization_id,email,invited_by_user_id,setup_token_id
     FROM portal_invitations
     WHERE organization_id=? AND email=? COLLATE NOCASE
       AND status='pending' AND expires_at<=?
     LIMIT 1`
  )
    .bind(principal.organizationId, email, createdAt)
    .first<ExpirablePortalInvitation>();
  if (expiredInvitation) {
    await expirePortalInvitationEnrollment(env, expiredInvitation, createdAt);
  }
  const existingMember = await env.DB.prepare(
    `SELECT m.organization_id,m.status
     FROM auth_users u
     JOIN portal_organization_members m ON m.user_id=u.id
     WHERE u.email=? COLLATE NOCASE
     LIMIT 1`
  )
    .bind(email)
    .first<{ organization_id: string; status: PortalTeamMemberStatus }>();
  if (existingMember) {
    return existingMember.organization_id === principal.organizationId
      ? portalTeamError(409, 'member_already_exists', '该邮箱已是当前 Partner 成员')
      : portalTeamError(409, 'identity_assigned_to_another_partner', '该身份已属于其他 Partner');
  }

  const invitationId = randomId('pinv');
  const token = randomInvitationToken();
  const tokenHash = await hashPortalInvitationToken(token);
  const expiresAt = invitationExpiryIso();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO portal_invitations
          (id,organization_id,email,role_id,token_hash,setup_token_id,status,
           expires_at,invited_by_user_id,revoked_by_user_id,accepted_by_user_id,
           accepted_at,revoked_at,version,created_at,updated_at)
         VALUES (?,?,?,?,?,NULL,'pending',?,?,NULL,NULL,NULL,NULL,1,?,?)`
      ).bind(
        invitationId,
        principal.organizationId,
        email,
        role.id,
        tokenHash,
        expiresAt,
        principal.userId,
        createdAt,
        createdAt
      ),
      guardedAuditStatement(env, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'team.invitation_created',
        targetType: 'invitation',
        targetId: invitationId,
        metadata: { email, role_id: role.id, role_code: role.code },
        createdAt,
        sourceTable: 'portal_invitations',
        sourceIdColumn: 'id',
        sourceId: invitationId,
      }),
    ]);
    if (results[0].meta.changes !== 1) {
      return portalTeamError(409, 'invitation_not_created', '邀请状态已变化，请重试');
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '';
    if (message.includes('UNIQUE')) {
      return portalTeamError(409, 'duplicate_pending_invitation', '该邮箱已有待处理邀请');
    }
    throw caught;
  }
  const invitation = await loadPortalInvitation(
    env,
    principal.organizationId,
    invitationId
  );
  return portalTeamJson(
    {
      data: {
        invitation: normalizeInvitation(invitation as PortalInvitationRow),
        invite_token: token,
        invite_url_fragment: `#invite_token=${encodeURIComponent(token)}`,
        setup_url:
          `/portal/setup?email=${encodeURIComponent(email)}` +
          `#invite_token=${encodeURIComponent(token)}`,
      },
    },
    201
  );
}

export async function revokePortalTeamInvitation(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal,
  invitationId: string
) {
  const permissionError = requirePortalTeamPermission(principal, 'team.invite');
  if (permissionError) return permissionError;
  const invitation = await loadPortalInvitation(
    env,
    principal.organizationId,
    invitationId
  );
  if (!invitation) return portalTeamError(404, 'invitation_not_found', '邀请不存在');
  const revokedAt = nowIso();
  if (effectiveInvitationStatus(invitation) === 'expired') {
    await expirePortalInvitationEnrollment(
      env,
      {
        invitation_id: invitation.id,
        organization_id: invitation.organization_id,
        email: invitation.email,
        invited_by_user_id: invitation.invited_by_user_id,
        setup_token_id: invitation.setup_token_id,
      },
      revokedAt
    );
    return portalTeamError(409, 'invitation_expired', '邀请已过期');
  }
  if (invitation.status !== 'pending') {
    return portalTeamError(409, 'invitation_not_pending', '仅待处理邀请可撤销');
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE portal_invitations
       SET status='revoked',revoked_by_user_id=?,revoked_at=?,
         version=version+1,updated_at=?
       WHERE id=? AND organization_id=? AND status='pending' AND version=?`
    ).bind(
      principal.userId,
      revokedAt,
      revokedAt,
      invitation.id,
      principal.organizationId,
      invitation.version
    ),
    env.DB.prepare(
      `UPDATE auth_setup_tokens SET used_at=?
       WHERE id=? AND used_at IS NULL
         AND EXISTS (
           SELECT 1 FROM portal_invitations i
           WHERE i.id=? AND i.organization_id=? AND i.status='revoked'
             AND i.updated_at=?
         )`
    ).bind(
      revokedAt,
      invitation.setup_token_id || '',
      invitation.id,
      principal.organizationId,
      revokedAt
    ),
    env.DB.prepare(
      `DELETE FROM portal_organization_members
       WHERE organization_id=? AND status='onboarding'
         AND user_id=(SELECT user_id FROM auth_setup_tokens WHERE id=?)
         AND EXISTS (
           SELECT 1 FROM portal_invitations i
           WHERE i.id=? AND i.organization_id=? AND i.status='revoked'
             AND i.updated_at=?
         )`
    ).bind(
      principal.organizationId,
      invitation.setup_token_id || '',
      invitation.id,
      principal.organizationId,
      revokedAt
    ),
    env.DB.prepare(
      `DELETE FROM auth_users
       WHERE id=(SELECT user_id FROM auth_setup_tokens WHERE id=?)
         AND setup_completed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM portal_organization_members m
           WHERE m.user_id=auth_users.id
         )
         AND EXISTS (
           SELECT 1 FROM portal_invitations i
           WHERE i.id=? AND i.organization_id=? AND i.status='revoked'
             AND i.updated_at=?
         )`
    ).bind(
      invitation.setup_token_id || '',
      invitation.id,
      principal.organizationId,
      revokedAt
    ),
    guardedAuditStatement(env, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: 'team.invitation_revoked',
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email: invitation.email, role_id: invitation.role_id },
      createdAt: revokedAt,
      sourceTable: 'portal_invitations',
      sourceIdColumn: 'id',
      sourceId: invitation.id,
    }),
  ]);
  if (results[0].meta.changes !== 1) {
    return portalTeamError(409, 'invitation_state_changed', '邀请已被其他操作处理');
  }
  const updated = await loadPortalInvitation(
    env,
    principal.organizationId,
    invitation.id
  );
  return portalTeamJson({ data: normalizeInvitation(updated as PortalInvitationRow) });
}

export async function patchPortalTeamMember(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal,
  memberId: string,
  request: Request
) {
  const permissionError = requirePortalTeamPermission(
    principal,
    'team.manage_members'
  );
  if (permissionError) return permissionError;
  const body = await readPortalTeamJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['role_id', 'status', 'version']);
  if (unknownFields) return unknownFields;
  if (!Number.isInteger(body.version) || Number(body.version) < 1) {
    return portalTeamError(422, 'validation_error', 'version 必须是正整数');
  }
  const current = await loadPortalMember(env, principal.organizationId, memberId);
  if (!current) return portalTeamError(404, 'member_not_found', '成员不存在');
  if (current.version !== Number(body.version)) {
    return portalTeamError(409, 'stale_member_version', '成员状态已更新，请刷新后重试');
  }
  if (memberId === principal.userId) {
    return portalTeamError(409, 'cannot_modify_self', '不能修改当前登录账户的角色或状态');
  }
  if (current.status === 'onboarding') {
    return portalTeamError(
      409,
      'onboarding_managed_by_invitation',
      '待激活成员只能通过邀请流程完成激活'
    );
  }
  const roleId = body.role_id === undefined
    ? current.role_id
    : typeof body.role_id === 'string'
      ? body.role_id.trim()
      : '';
  const status = body.status === undefined ? current.status : body.status;
  if (!roleId || (status !== 'active' && status !== 'suspended')) {
    return portalTeamError(422, 'validation_error', 'role_id 或 status 无效');
  }
  const role = await loadPortalRole(env, principal.organizationId, roleId);
  if (!role) return portalTeamError(404, 'role_not_found', '角色不存在');
  if (current.role_is_owner === 1 || role.is_owner === 1) {
    return portalTeamError(
      409,
      'owner_transfer_required',
      'Owner 角色只能通过独立的所有权转移流程变更'
    );
  }
  if (
    !principal.isOwner &&
    ((current.role_code === 'admin' && current.role_is_owner === 0) ||
      (role.code === 'admin' && role.is_system === 1))
  ) {
    return portalTeamError(403, 'owner_required_for_admin_role', '仅 Owner 可管理 Admin 成员');
  }
  const rolePermissions = await loadPortalRolePermissions(
    env,
    principal.organizationId,
    role.id
  );
  const delegationError = validateDelegatedPermissions(principal, rolePermissions);
  if (delegationError) return delegationError;
  if (role.id === current.role_id && status === current.status) {
    return portalTeamJson({ data: normalizeMember(current, principal.userId) });
  }
  const updatedAt = nowIso();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE portal_organization_members
         SET role_id=?,status=?,joined_at=CASE
             WHEN ?='active' AND joined_at IS NULL THEN ? ELSE joined_at END,
           version=version+1,updated_at=?
         WHERE organization_id=? AND user_id=? AND version=?`
      ).bind(
        role.id,
        status,
        status,
        updatedAt,
        updatedAt,
        principal.organizationId,
        memberId,
        current.version
      ),
      env.DB.prepare(
        `UPDATE auth_sessions SET revoked_at=?
         WHERE user_id=? AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM portal_organization_members m
             WHERE m.organization_id=? AND m.user_id=? AND m.updated_at=?
           )`
      ).bind(
        updatedAt,
        memberId,
        principal.organizationId,
        memberId,
        updatedAt
      ),
      guardedAuditStatement(env, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'team.member_updated',
        targetType: 'member',
        targetId: memberId,
        metadata: {
          previous_role_id: current.role_id,
          role_id: role.id,
          previous_status: current.status,
          status,
        },
        createdAt: updatedAt,
        sourceTable: 'portal_organization_members',
        sourceIdColumn: 'user_id',
        sourceId: memberId,
      }),
    ]);
    if (results[0].meta.changes !== 1) {
      return portalTeamError(409, 'stale_member_version', '成员状态已更新，请刷新后重试');
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '';
    if (message.includes('last_owner_required')) {
      return portalTeamError(409, 'last_owner_required', '组织必须保留至少一位已激活 Owner');
    }
    if (message.includes('UNIQUE')) {
      return portalTeamError(409, 'identity_assigned_to_another_partner', '该身份已属于其他 Partner');
    }
    throw caught;
  }
  const updated = await loadPortalMember(env, principal.organizationId, memberId);
  return portalTeamJson({
    data: normalizeMember(updated as PortalMemberRow, principal.userId),
  });
}

function parsePermissionKeys(value: unknown): PortalTeamPermission[] | Response {
  if (!Array.isArray(value)) {
    return portalTeamError(422, 'validation_error', 'permissions 必须是字符串数组');
  }
  const keys: PortalTeamPermission[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !isPortalTeamPermission(item) || seen.has(item)) {
      return portalTeamError(422, 'validation_error', 'permissions 包含无效或重复权限');
    }
    seen.add(item);
    keys.push(item);
  }
  if (!keys.length) {
    return portalTeamError(422, 'validation_error', '角色至少需要一个权限');
  }
  return keys.sort();
}

function validateCustomRoleText(
  value: unknown,
  field: 'name' | 'description',
  maxLength: number
) {
  if (typeof value !== 'string') {
    return portalTeamError(422, 'validation_error', `${field} 必须是字符串`);
  }
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength
    ? normalized
    : portalTeamError(
        422,
        'validation_error',
        `${field} 长度必须为 1-${maxLength} 个字符`
      );
}

function validateDelegatedPermissions(
  principal: PortalTeamPrincipal,
  permissions: PortalTeamPermission[]
) {
  if (!principal.isOwner && permissions.includes('credentials.reveal')) {
    return portalTeamError(
      403,
      'owner_required_for_restricted_permission',
      '仅 Owner 可授予 credentials.reveal 权限'
    );
  }
  const escalated = permissions.filter(
    (permission) => !principal.permissions.includes(permission)
  );
  return escalated.length
    ? portalTeamError(
        403,
        'permission_escalation_forbidden',
        '不能授予当前账户自身不具备的权限',
        { permissions: escalated }
      )
    : null;
}

async function portalRolePayload(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal,
  roleId: string
) {
  const role = await loadPortalRole(env, principal.organizationId, roleId);
  if (!role) return null;
  const permissions = await env.DB.prepare(
    `SELECT permission_key FROM portal_role_permissions
     WHERE role_id=? ORDER BY permission_key`
  )
    .bind(role.id)
    .all<{ permission_key: string }>();
  const normalizedPermissions = permissions.results
    .map((item) => item.permission_key)
    .filter(isPortalTeamPermission);
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    is_system: role.is_system === 1,
    is_owner: role.is_owner === 1,
    version: role.version,
    permissions: normalizedPermissions,
    member_count: Number(role.member_count || 0),
    assignable:
      role.is_owner !== 1 &&
      (principal.isOwner || !(role.is_system === 1 && role.code === 'admin')) &&
      normalizedPermissions.every((permission) =>
        principal.permissions.includes(permission)
      ),
    created_at: role.created_at,
    updated_at: role.updated_at,
  };
}

export async function createPortalTeamRole(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal,
  request: Request
) {
  const permissionError = requirePortalTeamPermission(
    principal,
    'team.manage_roles'
  );
  if (permissionError) return permissionError;
  const body = await readPortalTeamJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, [
    'code',
    'name',
    'description',
    'permissions',
  ]);
  if (unknownFields) return unknownFields;
  const name = validateCustomRoleText(body.name, 'name', 80);
  if (name instanceof Response) return name;
  const description = validateCustomRoleText(body.description, 'description', 300);
  if (description instanceof Response) return description;
  const permissions = parsePermissionKeys(body.permissions);
  if (permissions instanceof Response) return permissions;
  const delegationError = validateDelegatedPermissions(principal, permissions);
  if (delegationError) return delegationError;
  const suppliedCode = body.code === undefined ? '' : normalizeRoleCode(body.code);
  const code = suppliedCode || `custom_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!validRoleCode(code) || code === 'owner') {
    return portalTeamError(422, 'invalid_role_code', '自定义角色 code 格式无效或为保留值');
  }
  const roleId = randomId('prole');
  const createdAt = nowIso();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO portal_roles
          (id,organization_id,code,name,description,is_system,is_owner,version,
           created_at,updated_at)
         VALUES (?,?,?,?,?,0,0,1,?,?)`
      ).bind(
        roleId,
        principal.organizationId,
        code,
        name,
        description,
        createdAt,
        createdAt
      ),
      ...permissions.map((permission) =>
        env.DB.prepare(
          `INSERT INTO portal_role_permissions
            (role_id,permission_key,created_at)
           SELECT ?,?,?
           WHERE EXISTS (
             SELECT 1 FROM portal_roles
             WHERE id=? AND organization_id=? AND updated_at=?
           )`
        ).bind(
          roleId,
          permission,
          createdAt,
          roleId,
          principal.organizationId,
          createdAt
        )
      ),
      guardedAuditStatement(env, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'team.role_created',
        targetType: 'role',
        targetId: roleId,
        metadata: { code, permissions },
        createdAt,
        sourceTable: 'portal_roles',
        sourceIdColumn: 'id',
        sourceId: roleId,
      }),
    ]);
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      return portalTeamError(409, 'duplicate_role_code', '该角色 code 已存在');
    }
    throw caught;
  }
  return portalTeamJson(
    { data: await portalRolePayload(env, principal, roleId) },
    201
  );
}

export async function patchPortalTeamRole(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal,
  roleId: string,
  request: Request
) {
  const permissionError = requirePortalTeamPermission(
    principal,
    'team.manage_roles'
  );
  if (permissionError) return permissionError;
  const current = await loadPortalRole(env, principal.organizationId, roleId);
  if (!current) return portalTeamError(404, 'role_not_found', '角色不存在');
  if (current.is_system === 1 || current.is_owner === 1) {
    return portalTeamError(409, 'system_role_immutable', '系统角色不可修改');
  }
  const body = await readPortalTeamJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, [
    'name',
    'description',
    'permissions',
    'version',
  ]);
  if (unknownFields) return unknownFields;
  if (!Number.isInteger(body.version) || Number(body.version) < 1) {
    return portalTeamError(422, 'validation_error', 'version 必须是正整数');
  }
  if (current.version !== Number(body.version)) {
    return portalTeamError(409, 'stale_role_version', '角色已更新，请刷新后重试');
  }
  const name = body.name === undefined
    ? current.name
    : validateCustomRoleText(body.name, 'name', 80);
  if (name instanceof Response) return name;
  const description = body.description === undefined
    ? current.description
    : validateCustomRoleText(body.description, 'description', 300);
  if (description instanceof Response) return description;
  let permissions: PortalTeamPermission[] | null = null;
  if (body.permissions !== undefined) {
    const parsedPermissions = parsePermissionKeys(body.permissions);
    if (parsedPermissions instanceof Response) return parsedPermissions;
    const delegationError = validateDelegatedPermissions(
      principal,
      parsedPermissions
    );
    if (delegationError) return delegationError;
    permissions = parsedPermissions;
  }
  if (
    body.name === undefined &&
    body.description === undefined &&
    body.permissions === undefined
  ) {
    return portalTeamError(422, 'validation_error', '没有可更新的角色字段');
  }
  const updatedAt = nowIso();
  const nextVersion = current.version + 1;
  const mutationId = randomId('mut');
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE portal_roles
       SET name=?,description=?,version=?,mutation_id=?,updated_at=?
       WHERE id=? AND organization_id=? AND version=? AND is_system=0 AND is_owner=0`
    ).bind(
      name,
      description,
      nextVersion,
      mutationId,
      updatedAt,
      roleId,
      principal.organizationId,
      current.version
    ),
  ];
  if (permissions) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM portal_role_permissions
         WHERE role_id=?
           AND EXISTS (
           SELECT 1 FROM portal_roles
             WHERE id=? AND organization_id=? AND version=? AND mutation_id=?
           )`
      ).bind(
        roleId,
        roleId,
        principal.organizationId,
        nextVersion,
        mutationId
      )
    );
    statements.push(
      ...permissions.map((permission) =>
        env.DB.prepare(
          `INSERT INTO portal_role_permissions
            (role_id,permission_key,created_at)
           SELECT ?,?,?
           WHERE EXISTS (
             SELECT 1 FROM portal_roles
             WHERE id=? AND organization_id=? AND version=? AND mutation_id=?
           )`
        ).bind(
          roleId,
          permission,
          updatedAt,
          roleId,
          principal.organizationId,
          nextVersion,
          mutationId
        )
      )
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO portal_team_audit_events
        (id,organization_id,actor_user_id,action,target_type,target_id,
         metadata_json,created_at)
       SELECT ?,?,?,?,?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM portal_roles
         WHERE id=? AND organization_id=? AND version=? AND mutation_id=?
       )`
    ).bind(
      randomId('pta'),
      principal.organizationId,
      principal.userId,
      'team.role_updated',
      'role',
      roleId,
      JSON.stringify({
        previous_version: current.version,
        version: nextVersion,
        ...(permissions ? { permissions } : {}),
      }),
      updatedAt,
      roleId,
      principal.organizationId,
      nextVersion,
      mutationId
    )
  );
  const results = await env.DB.batch(statements);
  if (results[0].meta.changes !== 1) {
    return portalTeamError(409, 'stale_role_version', '角色已更新，请刷新后重试');
  }
  return portalTeamJson({ data: await portalRolePayload(env, principal, roleId) });
}

export async function deletePortalTeamRole(
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal,
  roleId: string,
  request: Request
) {
  const permissionError = requirePortalTeamPermission(
    principal,
    'team.manage_roles'
  );
  if (permissionError) return permissionError;
  const current = await loadPortalRole(env, principal.organizationId, roleId);
  if (!current) return portalTeamError(404, 'role_not_found', '角色不存在');
  if (current.is_system === 1 || current.is_owner === 1) {
    return portalTeamError(409, 'system_role_immutable', '系统角色不可删除');
  }
  const body = await readPortalTeamJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['version']);
  if (unknownFields) return unknownFields;
  if (!Number.isInteger(body.version) || Number(body.version) < 1) {
    return portalTeamError(422, 'validation_error', 'version 必须是正整数');
  }
  if (current.version !== Number(body.version)) {
    return portalTeamError(409, 'stale_role_version', '角色已更新，请刷新后重试');
  }
  const pendingInvitation = await env.DB.prepare(
    `SELECT id FROM portal_invitations
     WHERE organization_id=? AND role_id=? AND status='pending' LIMIT 1`
  )
    .bind(principal.organizationId, roleId)
    .first<{ id: string }>();
  if (current.member_count > 0 || pendingInvitation) {
    return portalTeamError(409, 'role_in_use', '角色已分配给成员或待处理邀请');
  }
  const deletedAt = nowIso();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO portal_team_audit_events
          (id,organization_id,actor_user_id,action,target_type,target_id,
           metadata_json,created_at)
         SELECT ?,r.organization_id,?,'team.role_deleted','role',r.id,?,?
         FROM portal_roles r
         WHERE r.id=? AND r.organization_id=? AND r.version=?
           AND r.is_system=0 AND r.is_owner=0`
      ).bind(
        randomId('pta'),
        principal.userId,
        JSON.stringify({ code: current.code }),
        deletedAt,
        roleId,
        principal.organizationId,
        current.version
      ),
      env.DB.prepare(
        `DELETE FROM portal_roles
         WHERE id=? AND organization_id=? AND version=?
           AND is_system=0 AND is_owner=0
         RETURNING id`
      ).bind(roleId, principal.organizationId, current.version),
    ]);
    const deleted = results[1].results.some(
      (row) => (row as { id?: string }).id === roleId
    );
    if (!deleted) {
      return portalTeamError(409, 'stale_role_version', '角色已更新，请刷新后重试');
    }
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('FOREIGN KEY')) {
      return portalTeamError(409, 'role_in_use', '角色已分配给成员或邀请');
    }
    throw caught;
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function beginPortalInvitationEnrollment(
  env: PortalTeamEnv,
  inviteToken: string
): Promise<Response | null> {
  if (inviteToken.length < 32 || inviteToken.length > 256) return null;
  const invitationTokenHash = await hashPortalInvitationToken(inviteToken);
  const setupTokenHash = await hashPortalAuthSetupToken(inviteToken);
  const invitation = await env.DB.prepare(
    `SELECT
       i.id AS invitation_id,i.organization_id,i.email,i.role_id,
       i.invited_by_user_id,i.expires_at,i.setup_token_id,
       t.token_hash AS setup_token_hash,
       t.expires_at AS setup_token_expires_at,
       t.used_at AS setup_token_used_at,
       u.id AS user_id,u.role AS user_role,u.status AS user_status,
       u.setup_completed_at,
       m.organization_id AS member_organization_id,m.status AS member_status
     FROM portal_invitations i
     LEFT JOIN auth_setup_tokens t ON t.id=i.setup_token_id
     LEFT JOIN auth_users u ON u.email=i.email COLLATE NOCASE
     LEFT JOIN portal_organization_members m ON m.user_id=u.id
     WHERE i.token_hash=?
     LIMIT 1`
  )
    .bind(invitationTokenHash)
    .first<PortalInvitationEnrollmentRow>();
  if (!invitation) return null;

  const createdAt = nowIso();
  if (Date.parse(invitation.expires_at) <= Date.parse(createdAt)) {
    await expirePortalInvitationEnrollment(env, invitation, createdAt);
    return portalTeamError(401, 'invalid_setup_token', 'Setup token 无效或已过期');
  }

  if (invitation.setup_token_id) {
    const prepared =
      invitation.user_id &&
      invitation.user_role === 'partner' &&
      invitation.user_status === 'active' &&
      !invitation.setup_completed_at &&
      invitation.member_organization_id === invitation.organization_id &&
      invitation.member_status === 'onboarding' &&
      invitation.setup_token_hash === setupTokenHash &&
      !invitation.setup_token_used_at &&
      Boolean(
        invitation.setup_token_expires_at &&
          Date.parse(invitation.setup_token_expires_at) > Date.parse(createdAt)
      );
    return prepared
      ? null
      : portalTeamError(401, 'invalid_setup_token', 'Setup token 无效或已过期');
  }

  if (invitation.user_id || invitation.member_organization_id) {
    return portalTeamError(
      409,
      'invitation_identity_conflict',
      '该邮箱已存在登录身份，不能通过此邀请重复加入'
    );
  }

  const userId = randomId('usr');
  const setupTokenId = randomId('set');
  const setupExpiresAt = new Date(
    Math.min(
      Date.parse(invitation.expires_at),
      Date.parse(createdAt) + 30 * 60 * 1000
    )
  ).toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO auth_users
          (id,email,role,status,password_hash,password_salt,password_iterations,
           totp_secret_ciphertext,totp_secret_iv,totp_enabled,last_totp_counter,
           recovery_codes_json,failed_password_attempts,locked_until,
           setup_completed_at,password_changed_at,last_login_at,created_at,updated_at)
         SELECT ?,i.email,'partner','active',NULL,NULL,NULL,NULL,NULL,0,-1,'[]',
           0,NULL,NULL,NULL,NULL,?,?
         FROM portal_invitations i
         WHERE i.id=? AND i.organization_id=? AND i.status='pending'
           AND i.expires_at>? AND i.setup_token_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM auth_users existing
             WHERE existing.email=i.email COLLATE NOCASE
           )`
      ).bind(
        userId,
        createdAt,
        createdAt,
        invitation.invitation_id,
        invitation.organization_id,
        createdAt
      ),
      env.DB.prepare(
        `INSERT INTO auth_setup_tokens
          (id,user_id,token_hash,expires_at,used_at,created_at)
         SELECT ?,?,?,?,NULL,?
         WHERE EXISTS (
           SELECT 1 FROM auth_users u
           JOIN portal_invitations i ON i.email=u.email COLLATE NOCASE
           WHERE u.id=? AND u.role='partner' AND u.status='active'
             AND u.setup_completed_at IS NULL
             AND i.id=? AND i.organization_id=? AND i.status='pending'
             AND i.expires_at>? AND i.setup_token_id IS NULL
         )`
      ).bind(
        setupTokenId,
        userId,
        setupTokenHash,
        setupExpiresAt,
        createdAt,
        userId,
        invitation.invitation_id,
        invitation.organization_id,
        createdAt
      ),
      env.DB.prepare(
        `INSERT INTO portal_organization_members
          (organization_id,user_id,role_id,display_name,status,version,
           invited_by_user_id,joined_at,created_at,updated_at)
         SELECT i.organization_id,?,i.role_id,NULL,'onboarding',1,
           i.invited_by_user_id,NULL,?,?
         FROM portal_invitations i
         JOIN auth_setup_tokens t ON t.id=? AND t.user_id=?
         WHERE i.id=? AND i.organization_id=? AND i.status='pending'
           AND i.expires_at>? AND i.setup_token_id IS NULL`
      ).bind(
        userId,
        createdAt,
        createdAt,
        setupTokenId,
        userId,
        invitation.invitation_id,
        invitation.organization_id,
        createdAt
      ),
      env.DB.prepare(
        `UPDATE portal_invitations
         SET setup_token_id=?,version=version+1,updated_at=?
         WHERE id=? AND organization_id=? AND status='pending'
           AND expires_at>? AND setup_token_id IS NULL
           AND EXISTS (
             SELECT 1 FROM portal_organization_members m
             WHERE m.organization_id=portal_invitations.organization_id
               AND m.user_id=? AND m.role_id=portal_invitations.role_id
               AND m.status='onboarding' AND m.updated_at=?
           )`
      ).bind(
        setupTokenId,
        createdAt,
        invitation.invitation_id,
        invitation.organization_id,
        createdAt,
        userId,
        createdAt
      ),
      env.DB.prepare(
        `INSERT INTO portal_team_audit_events
          (id,organization_id,actor_user_id,action,target_type,target_id,
           metadata_json,created_at)
         VALUES (
           ?,
           (SELECT organization_id FROM portal_invitations
             WHERE id=? AND organization_id=? AND setup_token_id=?
               AND status='pending' AND updated_at=?),
           ?,'team.invitation_enrollment_started','invitation',?,?,?
         )`
      ).bind(
        randomId('pta'),
        invitation.invitation_id,
        invitation.organization_id,
        setupTokenId,
        createdAt,
        invitation.invited_by_user_id,
        invitation.invitation_id,
        JSON.stringify({ email: invitation.email, user_id: userId }),
        createdAt
      ),
    ]);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '';
    if (
      message.includes('UNIQUE') ||
      message.includes('NOT NULL') ||
      message.includes('FOREIGN KEY')
    ) {
      return portalTeamError(
        409,
        'invitation_state_changed',
        '邀请状态已变化，请重新获取邀请链接'
      );
    }
    throw caught;
  }
  return null;
}

export async function portalInvitationEnrollmentStatements(
  env: PortalTeamEnv,
  userId: string,
  verifiedAt: string
): Promise<D1PreparedStatement[]> {
  const onboarding = await env.DB.prepare(
    `SELECT
       i.organization_id,m.status AS member_status,
       i.id AS invitation_id,i.version AS invitation_version,
       i.status AS invitation_status,i.expires_at
     FROM auth_setup_tokens t
     JOIN portal_invitations i ON i.setup_token_id=t.id
     LEFT JOIN portal_organization_members m
       ON m.user_id=t.user_id AND m.organization_id=i.organization_id
     WHERE t.user_id=?
     ORDER BY i.created_at DESC
     LIMIT 1`
  )
    .bind(userId)
    .first<{
      organization_id: string;
      member_status: PortalTeamMemberStatus | null;
      invitation_id: string | null;
      invitation_version: number | null;
      invitation_status: PortalTeamInvitationStatus | null;
      expires_at: string | null;
    }>();
  if (!onboarding) return [];
  if (
    !onboarding.invitation_id ||
    onboarding.invitation_status !== 'pending' ||
    onboarding.member_status !== 'onboarding' ||
    !onboarding.expires_at ||
    Date.parse(onboarding.expires_at) <= Date.parse(verifiedAt) ||
    !onboarding.invitation_version
  ) {
    throw new Error('portal_invitation_activation_invalid');
  }

  const invitationId = onboarding.invitation_id;
  const organizationId = onboarding.organization_id;
  return [
    env.DB.prepare(
      `UPDATE portal_organization_members
       SET status='active',joined_at=COALESCE(joined_at,?),
         version=version+1,updated_at=?
       WHERE organization_id=? AND user_id=? AND status='onboarding'
         AND EXISTS (
           SELECT 1 FROM portal_invitations i
           JOIN auth_setup_tokens t ON t.id=i.setup_token_id
           WHERE i.id=? AND i.organization_id=? AND i.status='pending'
             AND i.version=? AND i.expires_at>? AND t.user_id=?
         )`
    ).bind(
      verifiedAt,
      verifiedAt,
      organizationId,
      userId,
      invitationId,
      organizationId,
      onboarding.invitation_version,
      verifiedAt,
      userId
    ),
    env.DB.prepare(
      `UPDATE portal_invitations
       SET status='accepted',accepted_by_user_id=?,accepted_at=?,
         version=version+1,updated_at=?
       WHERE id=? AND organization_id=? AND status='pending'
         AND version=? AND expires_at>?
         AND EXISTS (
           SELECT 1 FROM portal_organization_members m
           WHERE m.organization_id=portal_invitations.organization_id
             AND m.user_id=? AND m.status='active' AND m.updated_at=?
         )`
    ).bind(
      userId,
      verifiedAt,
      verifiedAt,
      invitationId,
      organizationId,
      onboarding.invitation_version,
      verifiedAt,
      userId,
      verifiedAt
    ),
    env.DB.prepare(
      `INSERT INTO portal_team_audit_events
        (id,organization_id,actor_user_id,action,target_type,target_id,
         metadata_json,created_at)
       VALUES (
         ?,
         (SELECT organization_id FROM portal_invitations
           WHERE id=? AND organization_id=? AND status='accepted'
             AND accepted_by_user_id=? AND accepted_at=?),
         ?,'team.invitation_accepted','invitation',?,?,?
       )`
    ).bind(
      randomId('pta'),
      invitationId,
      organizationId,
      userId,
      verifiedAt,
      userId,
      invitationId,
      JSON.stringify({ user_id: userId }),
      verifiedAt
    ),
  ];
}

function decodedTeamRouteSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && !decoded.includes('/') && !decoded.includes('\\')
      ? decoded
      : null;
  } catch {
    return null;
  }
}

export async function handlePortalTeamRequest(
  request: Request,
  env: PortalTeamEnv,
  principal: PortalTeamPrincipal
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (
    pathname !== PORTAL_TEAM_API_PREFIX &&
    !pathname.startsWith(`${PORTAL_TEAM_API_PREFIX}/`)
  ) {
    return null;
  }
  const suffix = pathname.slice(PORTAL_TEAM_API_PREFIX.length);
  const method = request.method.toUpperCase();
  if (suffix === '/members' && method === 'GET') {
    return listPortalTeamMembers(env, principal);
  }
  if (suffix === '/invitations' && method === 'GET') {
    return listPortalTeamInvitations(env, principal);
  }
  if (suffix === '/invitations' && method === 'POST') {
    return createPortalTeamInvitation(env, principal, request);
  }
  if (suffix === '/roles' && method === 'GET') {
    return listPortalTeamRoles(env, principal);
  }
  if (suffix === '/roles' && method === 'POST') {
    return createPortalTeamRole(env, principal, request);
  }

  const parts = suffix.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'members' && method === 'PATCH') {
    const memberId = decodedTeamRouteSegment(parts[1]);
    return memberId
      ? patchPortalTeamMember(env, principal, memberId, request)
      : portalTeamError(400, 'invalid_route_parameter', '成员 ID 无效');
  }
  if (
    parts.length === 3 &&
    parts[0] === 'invitations' &&
    parts[2] === 'revoke' &&
    method === 'POST'
  ) {
    const invitationId = decodedTeamRouteSegment(parts[1]);
    return invitationId
      ? revokePortalTeamInvitation(env, principal, invitationId)
      : portalTeamError(400, 'invalid_route_parameter', '邀请 ID 无效');
  }
  if (parts.length === 2 && parts[0] === 'roles') {
    const roleId = decodedTeamRouteSegment(parts[1]);
    if (!roleId) return portalTeamError(400, 'invalid_route_parameter', '角色 ID 无效');
    if (method === 'PATCH') return patchPortalTeamRole(env, principal, roleId, request);
    if (method === 'DELETE') return deletePortalTeamRole(env, principal, roleId, request);
  }

  const knownResource = ['/members', '/invitations', '/roles'].some(
    (resource) => suffix === resource || suffix.startsWith(`${resource}/`)
  );
  return knownResource
    ? portalTeamError(405, 'method_not_allowed', '不支持该请求方法')
    : portalTeamError(404, 'team_route_not_found', '团队管理接口不存在');
}
