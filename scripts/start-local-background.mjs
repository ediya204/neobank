import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const devScript = fileURLToPath(new URL('./dev-local.mjs', import.meta.url));
const logPath = '/tmp/neobook-local-full-stack.log';
const pidPath = '/tmp/neobook-local-full-stack.pid';

async function endpointReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function stackReady() {
  const [webReady, apiReady] = await Promise.all([
    endpointReady('http://localhost:3002/portal/home'),
    endpointReady('http://localhost:4000/api/v1/health'),
  ]);
  return webReady && apiReady;
}

if (await stackReady()) {
  console.log('Local full stack is already ready: Web :3002, API :4000');
  process.exit(0);
}

try {
  const previousPid = Number(readFileSync(pidPath, 'utf8').trim());
  if (Number.isInteger(previousPid) && previousPid > 0) process.kill(previousPid, 0);
  console.error(`Local background process ${previousPid} is alive but the stack is not ready.`);
  console.error(`Inspect ${logPath} before restarting it.`);
  process.exit(1);
} catch {
  // A missing or stale PID file is safe to replace.
}

const logDescriptor = openSync(logPath, 'a');
const child = spawn(process.execPath, [devScript], {
  cwd: projectRoot,
  detached: true,
  env: process.env,
  stdio: ['ignore', logDescriptor, logDescriptor],
});
child.unref();
closeSync(logDescriptor);
writeFileSync(pidPath, `${child.pid}\n`, 'utf8');

for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await stackReady()) {
    console.log(`Local full stack started in background (PID ${child.pid}).`);
    console.log(`Log: ${logPath}`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

console.error(`Local full stack did not become ready. Inspect ${logPath}.`);
process.exit(1);
