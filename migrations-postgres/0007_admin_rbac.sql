ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS access_role TEXT NOT NULL DEFAULT 'super_admin',
  ADD COLUMN IF NOT EXISTS core_user_id TEXT,
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_access_role_check'
  ) THEN
    ALTER TABLE admin_users
      ADD CONSTRAINT admin_users_access_role_check
      CHECK (access_role IN ('super_admin', 'operations_admin', 'compliance_admin', 'read_only_admin'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_version_check'
  ) THEN
    ALTER TABLE admin_users
      ADD CONSTRAINT admin_users_version_check CHECK (version >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM admin_users admin_user
    JOIN "User" core_user ON LOWER(core_user.email) = LOWER(admin_user.email)
    WHERE core_user.role <> 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'an administrator email is already assigned to a non-admin Core user';
  END IF;
END $$;

INSERT INTO "User" (
  id,
  "organizationId",
  email,
  "displayName",
  role,
  active,
  "createdAt",
  "updatedAt"
)
SELECT
  admin_user.id,
  organization.id,
  admin_user.email,
  admin_user.display_name,
  'ADMIN'::"UserRole",
  admin_user.status = 'active',
  admin_user.created_at::timestamptz,
  admin_user.updated_at::timestamptz
FROM admin_users admin_user
CROSS JOIN LATERAL (
  SELECT id
  FROM "Organization"
  WHERE slug = 'ssc-digital-bank' OR id = 'org_neobank'
  ORDER BY (id = 'org_neobank') DESC
  LIMIT 1
) organization
WHERE NOT EXISTS (
  SELECT 1 FROM "User" core_user WHERE LOWER(core_user.email) = LOWER(admin_user.email)
);

UPDATE admin_users admin_user
SET core_user_id = core_user.id
FROM "User" core_user
WHERE LOWER(core_user.email) = LOWER(admin_user.email)
  AND admin_user.core_user_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM admin_users WHERE core_user_id IS NULL) THEN
    RAISE EXCEPTION 'every administrator must be linked to a Core user';
  END IF;
END $$;

ALTER TABLE admin_users ALTER COLUMN core_user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_core_user_id
  ON admin_users (core_user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_core_user_id_fkey'
  ) THEN
    ALTER TABLE admin_users
      ADD CONSTRAINT admin_users_core_user_id_fkey
      FOREIGN KEY (core_user_id) REFERENCES "User"(id) ON DELETE RESTRICT;
  END IF;
END $$;

INSERT INTO neobank_schema_migrations (version)
VALUES ('0007_admin_rbac')
ON CONFLICT (version) DO NOTHING;
