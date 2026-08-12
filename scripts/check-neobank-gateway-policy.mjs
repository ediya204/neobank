import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const goSource = await readFile(new URL('server-go/cmd/api/cregis_handlers.go', root), 'utf8');
const workerSource = await readFile(new URL('worker-d1-gateway/index.ts', root), 'utf8');

const normalize = (sql) => sql.trim().replace(/\s+/g, ' ').toUpperCase();
const writes = new Set();

for (const match of goSource.matchAll(/SQL:\s*`([\s\S]*?)`/g)) {
  if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(match[1].trim())) writes.add(normalize(match[1]));
}
for (const match of goSource.matchAll(/app\.db\.Query\([^,]+,\s*`([\s\S]*?)`/g)) {
  if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(match[1].trim())) writes.add(normalize(match[1]));
}

const policyMatch = workerSource.match(
  /const ALLOWED_WRITE_SQL = new Set\(\s*\[([\s\S]*?)\]\.map\(normalizeSQL\)\s*\);/
);
if (!policyMatch) throw new Error('Could not locate ALLOWED_WRITE_SQL');
const allowed = new Set(Array.from(policyMatch[1].matchAll(/`([\s\S]*?)`/g), (match) => normalize(match[1])));

const missing = [...writes].filter((sql) => !allowed.has(sql));
const stale = [...allowed].filter((sql) => !writes.has(sql));
if (missing.length || stale.length) {
  console.error(JSON.stringify({ missing, stale }, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Gateway policy matches ${writes.size} Go write statements.`);
}
