import { spawn } from 'node:child_process';

const localCoreEnv = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgresql://va_payment:va_payment_local@localhost:5432/va_payment?schema=public',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  WEB_ORIGIN:
    process.env.WEB_ORIGIN || 'http://localhost:3002,http://localhost:8787,http://127.0.0.1:8787',
};

const childSpecs = [
  {
    name: 'API',
    process: spawn('npm', ['run', 'start:dev'], {
      cwd: new URL('../server/', import.meta.url),
      stdio: 'inherit',
      env: { ...localCoreEnv, PORT: process.env.PORT || '4000' },
      detached: process.platform !== 'win32',
    }),
  },
  {
    name: 'Web',
    process: spawn('npm', ['start'], {
      cwd: new URL('../', import.meta.url),
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: process.env.WEB_PORT || '3002',
        BROWSER: 'none',
        REACT_APP_LOCAL_DEMO: 'true',
        REACT_APP_CORE_API_URL:
          process.env.REACT_APP_CORE_API_URL || 'http://localhost:4000/api/v1',
      },
      detached: process.platform !== 'win32',
    }),
  },
];

let requestedShutdown = false;

function signalChild(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function shutdown(signal) {
  requestedShutdown = true;
  for (const childSpec of childSpecs) signalChild(childSpec.process, signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const exitCode = await Promise.race(
  childSpecs.map(
    ({ name, process: child }) =>
      new Promise((resolve) => {
        child.on('error', (error) => resolve({ name, code: 1, error }));
        child.on('exit', (code, signal) => resolve({ name, code, signal }));
      })
  )
);

const unexpectedExit = !requestedShutdown;
if (exitCode.error) console.error(`${exitCode.name} process failed to start:`, exitCode.error);
else if (unexpectedExit) {
  console.error(
    `${exitCode.name} process exited unexpectedly (code=${exitCode.code ?? 'none'}, signal=${
      exitCode.signal ?? 'none'
    }).`
  );
}

shutdown('SIGTERM');
process.exit(unexpectedExit ? Number(exitCode.code || 1) : 0);
