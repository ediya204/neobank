CREATE TABLE IF NOT EXISTS portal_notification_reads (
  user_id TEXT NOT NULL,
  audit_log_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, audit_log_id),
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (audit_log_id) REFERENCES audit_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portal_notification_reads_user
  ON portal_notification_reads(user_id, read_at DESC);
