PRAGMA foreign_keys = ON;

-- Keep permission replacement bound to the role UPDATE that won its optimistic
-- concurrency check. This is a separate migration because Wrangler records
-- applied filenames and does not replay an edited 0020 migration.
ALTER TABLE portal_roles
  ADD COLUMN mutation_id TEXT NOT NULL DEFAULT ''
    CHECK (length(mutation_id) <= 64);
