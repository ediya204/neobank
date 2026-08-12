import { readFileSync, unlinkSync } from 'node:fs';

const pidPath = '/tmp/neobook-local-full-stack.pid';

let pid;
try {
  pid = Number(readFileSync(pidPath, 'utf8').trim());
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.log('No recorded local background stack is running.');
    process.exit(0);
  }
  throw error;
}

if (!Number.isInteger(pid) || pid <= 0) {
  console.error(`Invalid local background PID: ${pid}`);
  process.exit(1);
}

try {
  process.kill(-pid, 'SIGTERM');
} catch (error) {
  if (error?.code !== 'ESRCH') throw error;
}

for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    process.kill(-pid, 0);
  } catch (error) {
    if (error?.code === 'ESRCH') {
      unlinkSync(pidPath);
      console.log(`Local background stack ${pid} stopped.`);
      process.exit(0);
    }
    throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

console.error(`Local background process group ${pid} did not stop within 5 seconds.`);
process.exit(1);
