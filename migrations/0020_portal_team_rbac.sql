PRAGMA foreign_keys = ON;

-- Portal human users belong to exactly one Partner organization. V1 exposes no
-- organization-creation API; the existing Ethan Partner is seeded below.
CREATE TABLE IF NOT EXISTS portal_organizations (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(partner_key) BETWEEN 1 AND 100),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_permissions (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL
    CHECK (category IN (
      'team', 'customers', 'transactions', 'balances', 'integrations',
      'credentials', 'notifications'
    )),
  risk_level TEXT NOT NULL DEFAULT 'standard'
    CHECK (risk_level IN ('standard', 'restricted')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 300)
);

CREATE TABLE IF NOT EXISTS portal_roles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL
    CHECK (
      length(code) BETWEEN 2 AND 50 AND
      code = lower(code) AND
      substr(code, 1, 1) GLOB '[a-z]' AND
      code NOT GLOB '*[^a-z0-9_]*'
    ),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES portal_organizations(id) ON DELETE CASCADE,
  UNIQUE (organization_id, code),
  UNIQUE (id, organization_id),
  CHECK (
    (code = 'owner' AND is_system = 1 AND is_owner = 1) OR
    (code <> 'owner' AND is_owner = 0)
  )
);

CREATE TABLE IF NOT EXISTS portal_role_permissions (
  role_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (role_id) REFERENCES portal_roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_key) REFERENCES portal_permissions(key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS portal_organization_members (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  role_id TEXT NOT NULL,
  display_name TEXT CHECK (
    display_name IS NULL OR length(display_name) BETWEEN 1 AND 160
  ),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('onboarding', 'active', 'suspended')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  invited_by_user_id TEXT,
  joined_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES portal_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES auth_users(id) ON DELETE SET NULL,
  FOREIGN KEY (role_id, organization_id)
    REFERENCES portal_roles(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_portal_members_org_status
  ON portal_organization_members(organization_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_portal_members_org_role
  ON portal_organization_members(organization_id, role_id, status);

CREATE TABLE IF NOT EXISTS portal_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE
    CHECK (length(email) BETWEEN 3 AND 254),
  role_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  setup_token_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL,
  revoked_by_user_id TEXT,
  accepted_by_user_id TEXT,
  accepted_at TEXT,
  revoked_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES portal_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (setup_token_id) REFERENCES auth_setup_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (invited_by_user_id) REFERENCES auth_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (revoked_by_user_id) REFERENCES auth_users(id) ON DELETE SET NULL,
  FOREIGN KEY (accepted_by_user_id) REFERENCES auth_users(id) ON DELETE SET NULL,
  FOREIGN KEY (role_id, organization_id)
    REFERENCES portal_roles(id, organization_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'accepted' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL) OR
    (status <> 'accepted' AND accepted_by_user_id IS NULL AND accepted_at IS NULL)
  ),
  CHECK (
    (status = 'revoked' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL) OR
    (status <> 'revoked' AND revoked_by_user_id IS NULL AND revoked_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_invitations_pending_email
  ON portal_invitations(organization_id, email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_portal_invitations_org_status
  ON portal_invitations(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_invitations_expiry
  ON portal_invitations(expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS portal_team_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  target_type TEXT NOT NULL
    CHECK (target_type IN ('organization', 'member', 'invitation', 'role')),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES portal_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES auth_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_portal_team_audit_org_created
  ON portal_team_audit_events(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_team_audit_actor_created
  ON portal_team_audit_events(actor_user_id, created_at DESC);

-- A Partner organization must never lose its last active Owner.
CREATE TRIGGER IF NOT EXISTS portal_members_last_owner_update
BEFORE UPDATE OF organization_id, role_id, status
ON portal_organization_members
WHEN OLD.status = 'active'
  AND EXISTS (
    SELECT 1 FROM portal_roles old_role
    WHERE old_role.id = OLD.role_id
      AND old_role.organization_id = OLD.organization_id
      AND old_role.is_owner = 1
  )
  AND NOT (
    NEW.organization_id = OLD.organization_id
    AND NEW.status = 'active'
    AND EXISTS (
      SELECT 1 FROM portal_roles new_role
      WHERE new_role.id = NEW.role_id
        AND new_role.organization_id = NEW.organization_id
        AND new_role.is_owner = 1
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM portal_organization_members other_member
    JOIN portal_roles other_role
      ON other_role.id = other_member.role_id
     AND other_role.organization_id = other_member.organization_id
    WHERE other_member.organization_id = OLD.organization_id
      AND other_member.user_id <> OLD.user_id
      AND other_member.status = 'active'
      AND other_role.is_owner = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'last_owner_required');
END;

CREATE TRIGGER IF NOT EXISTS portal_members_last_owner_delete
BEFORE DELETE ON portal_organization_members
WHEN OLD.status = 'active'
  AND EXISTS (
    SELECT 1 FROM portal_roles old_role
    WHERE old_role.id = OLD.role_id
      AND old_role.organization_id = OLD.organization_id
      AND old_role.is_owner = 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM portal_organization_members other_member
    JOIN portal_roles other_role
      ON other_role.id = other_member.role_id
     AND other_role.organization_id = other_member.organization_id
    WHERE other_member.organization_id = OLD.organization_id
      AND other_member.user_id <> OLD.user_id
      AND other_member.status = 'active'
      AND other_role.is_owner = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'last_owner_required');
END;

INSERT OR IGNORE INTO portal_organizations
  (id, partner_key, name, status, created_at, updated_at)
VALUES
  ('org_ethan', 'ethan', 'Ethan Partner', 'active',
   '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');

INSERT OR IGNORE INTO portal_permissions
  (key, category, risk_level, description)
VALUES
  ('team.read', 'team', 'standard', 'View organization members, invitations, and roles'),
  ('team.invite', 'team', 'standard', 'Create and revoke organization invitations'),
  ('team.manage_members', 'team', 'standard', 'Change member roles and account status'),
  ('team.manage_roles', 'team', 'standard', 'View and manage role permission assignments'),
  ('customers.read', 'customers', 'standard', 'View downstream customer profiles'),
  ('customers.create', 'customers', 'standard', 'Create downstream customer applications'),
  ('transactions.read', 'transactions', 'standard', 'View transaction history'),
  ('balances.read', 'balances', 'standard', 'View customer balances'),
  ('integrations.read', 'integrations', 'standard', 'View Partner API integration settings'),
  ('integrations.request_change', 'integrations', 'standard', 'Request integration configuration changes'),
  ('credentials.reveal', 'credentials', 'restricted', 'Reveal a one-time Partner API client secret'),
  ('notifications.read', 'notifications', 'standard', 'View Portal notifications');

INSERT OR IGNORE INTO portal_roles
  (id, organization_id, code, name, description, is_system, is_owner, version,
   created_at, updated_at)
VALUES
  ('role_ethan_owner', 'org_ethan', 'owner', 'Owner',
   'Organization owner with every Portal permission', 1, 1, 1,
   '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_admin', 'org_ethan', 'admin', 'Admin',
   'Team administrator without one-time credential reveal', 1, 0, 1,
   '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_operations', 'org_ethan', 'operations', 'Operations',
   'Customer onboarding and financial visibility', 1, 0, 1,
   '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_developer', 'org_ethan', 'developer', 'Developer',
   'Partner API integration visibility and change requests', 1, 0, 1,
   '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_viewer', 'org_ethan', 'viewer', 'Viewer',
   'Read-only customer and financial visibility', 1, 0, 1,
   '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');

-- Owner receives the complete fixed permission catalog.
INSERT OR IGNORE INTO portal_role_permissions
  (role_id, permission_key, created_at)
SELECT 'role_ethan_owner', key, '2026-08-02T00:00:00.000Z'
FROM portal_permissions;

-- Admin receives every standard permission; credential reveal stays Owner-only.
INSERT OR IGNORE INTO portal_role_permissions
  (role_id, permission_key, created_at)
SELECT 'role_ethan_admin', key, '2026-08-02T00:00:00.000Z'
FROM portal_permissions
WHERE key <> 'credentials.reveal';

INSERT OR IGNORE INTO portal_role_permissions
  (role_id, permission_key, created_at)
VALUES
  ('role_ethan_operations', 'team.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_operations', 'customers.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_operations', 'customers.create', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_operations', 'transactions.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_operations', 'balances.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_operations', 'notifications.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_developer', 'team.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_developer', 'integrations.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_developer', 'integrations.request_change', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_developer', 'notifications.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_viewer', 'team.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_viewer', 'customers.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_viewer', 'transactions.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_viewer', 'balances.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_viewer', 'integrations.read', '2026-08-02T00:00:00.000Z'),
  ('role_ethan_viewer', 'notifications.read', '2026-08-02T00:00:00.000Z');
