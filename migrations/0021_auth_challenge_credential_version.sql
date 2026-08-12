-- Bind new login challenges to the password version that created them.
-- Existing rows intentionally remain NULL and are rejected by the Worker.
ALTER TABLE auth_login_challenges
  ADD COLUMN credential_version TEXT;
