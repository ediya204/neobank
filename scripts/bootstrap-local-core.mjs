import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const psql = '/opt/homebrew/opt/postgresql@17/bin/psql';
const redisCli = '/opt/homebrew/opt/redis/bin/redis-cli';
const redisServer = '/opt/homebrew/opt/redis/bin/redis-server';
const localCoreEnv = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgresql://va_payment:va_payment_local@localhost:5432/va_payment?schema=public',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
};

if (!existsSync(psql)) {
  console.error('PostgreSQL 17 is not installed. Run: brew install postgresql@17 redis');
  process.exit(1);
}
if (!existsSync(redisCli) || !existsSync(redisServer)) {
  console.error('Redis is not installed. Run: brew install redis');
  process.exit(1);
}

if (!isReady('/opt/homebrew/opt/postgresql@17/bin/pg_isready', ['-h', 'localhost'])) {
  run('brew', ['services', 'start', 'postgresql@17']);
}
if (!isReady(redisCli, ['-h', '127.0.0.1', '-p', '6379', 'ping'])) {
  run('brew', ['services', 'restart', 'redis']);
}

if (!isReady(redisCli, ['-h', '127.0.0.1', '-p', '6379', 'ping'])) {
  console.warn('Homebrew Redis service is unavailable; starting an isolated local-only instance.');
  run(redisServer, [
    '--daemonize',
    'yes',
    '--bind',
    '127.0.0.1',
    '--port',
    '6379',
    '--save',
    '',
    '--appendonly',
    'no',
  ]);
}

let ready = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const result = spawnSync('/opt/homebrew/opt/postgresql@17/bin/pg_isready', ['-h', 'localhost']);
  if (result.status === 0) {
    ready = true;
    break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
}
if (!ready) throw new Error('PostgreSQL did not become ready');

let redisReady = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (isReady(redisCli, ['-h', '127.0.0.1', '-p', '6379', 'ping'])) {
    redisReady = true;
    break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
}
if (!redisReady) throw new Error('Redis did not become ready');

run(psql, [
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='va_payment') THEN CREATE ROLE va_payment LOGIN PASSWORD 'va_payment_local'; ELSE ALTER ROLE va_payment WITH LOGIN PASSWORD 'va_payment_local'; END IF; END $$;",
]);

const databaseExists =
  spawnSync(psql, ['postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='va_payment'"], {
    encoding: 'utf8',
  }).stdout.trim() === '1';
if (!databaseExists)
  run('/opt/homebrew/opt/postgresql@17/bin/createdb', ['-O', 'va_payment', 'va_payment']);

run('npm', ['--prefix', 'server', 'run', 'prisma:deploy'], projectRoot);
run('npm', ['--prefix', 'server', 'run', 'seed'], projectRoot);
console.log('Local core is ready: PostgreSQL :5432, Redis :6379, API :4000, Web :3002');

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: localCoreEnv });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function isReady(command, args) {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0;
}
