import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
const cachePath = join(cacheRoot, 'sgb-va-api', 'npm');
const lockRoot = join(cacheRoot, 'sgb-va-api', 'locks');
const worktreeKey = createHash('sha256')
  .update(realpathSync(process.cwd()))
  .digest('hex')
  .slice(0, 16);
const lockPath = join(lockRoot, `${worktreeKey}.lock`);
mkdirSync(cachePath, { recursive: true, mode: 0o700 });
mkdirSync(lockRoot, { recursive: true, mode: 0o700 });

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function acquireInstallLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existingPid = Number.parseInt(readFileSync(lockPath, 'utf8'), 10);
      if (Number.isInteger(existingPid) && existingPid > 0 && processExists(existingPid)) {
        console.error(
          `Another release dependency install is already running for this worktree (PID ${existingPid}).`
        );
        process.exit(73);
      }
      unlinkSync(lockPath);
    }
  }
  throw new Error(`Unable to acquire release install lock: ${lockPath}`);
}

function releaseInstallLock() {
  try {
    const ownerPid = Number.parseInt(readFileSync(lockPath, 'utf8'), 10);
    if (ownerPid === process.pid) unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

acquireInstallLock();

console.log(`Installing locked dependencies with cache: ${cachePath}`);
const child = spawn('npm', ['ci', ...process.argv.slice(2)], {
  env: {
    ...process.env,
    npm_config_cache: cachePath,
  },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

child.once('error', (error) => {
  releaseInstallLock();
  console.error(error.message);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  releaseInstallLock();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
