import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'start:dev'], {
    cwd: new URL('../server/', import.meta.url),
    stdio: 'inherit',
    env: { ...process.env, PORT: process.env.PORT || '4000' },
  }),
  spawn('npm', ['start'], {
    cwd: new URL('../', import.meta.url),
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: process.env.WEB_PORT || '3002',
      BROWSER: 'none',
      REACT_APP_LOCAL_DEMO: 'true',
      REACT_APP_CORE_API_URL: process.env.REACT_APP_CORE_API_URL || 'http://localhost:4000/api/v1',
    },
  }),
];

function shutdown(signal) {
  for (const child of children) child.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const exitCode = await Promise.race(
  children.map((child) => new Promise((resolve) => child.on('exit', (code) => resolve(code || 0))))
);
shutdown('SIGTERM');
process.exit(Number(exitCode));
