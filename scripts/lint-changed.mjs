import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePattern = /^src\/.*\.(?:js|jsx|ts|tsx)$/;
const argumentsAfterSeparator = process.argv.slice(2);
const baseIndex = argumentsAfterSeparator.indexOf('--base');
const base = baseIndex >= 0 ? argumentsAfterSeparator[baseIndex + 1] : null;

if (baseIndex >= 0 && !base) {
  console.error('Usage: npm run lint:changed -- [--base <git-ref>]');
  process.exit(2);
}

function gitLines(args, allowFailure = false) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', allowFailure ? 'ignore' : 'inherit'],
  });
  if (result.status !== 0) {
    if (allowFailure) return [];
    process.exit(result.status ?? 1);
  }
  return result.stdout.split('\n').filter(Boolean);
}

const candidates = new Set([
  ...gitLines(['diff', '--name-only', '--diff-filter=ACMR', '--']),
  ...gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--']),
  ...gitLines(['ls-files', '--others', '--exclude-standard']),
]);

if (base) {
  const baseExists = spawnSync('git', ['rev-parse', '--verify', '--quiet', base], {
    stdio: 'ignore',
  });
  if (baseExists.status !== 0) {
    console.error(`Git base ref does not exist: ${base}`);
    process.exit(2);
  }
  for (const file of gitLines([
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    `${base}...HEAD`,
    '--',
  ])) {
    candidates.add(file);
  }
}

const files = [...candidates].filter((file) => sourcePattern.test(file) && existsSync(file)).sort();

if (files.length === 0) {
  console.log('No changed JavaScript or TypeScript source files to lint.');
  process.exit(0);
}

console.log(`Linting ${files.length} changed source file(s).`);
const eslintBin = resolve('node_modules/eslint/bin/eslint.js');
const result = spawnSync(process.execPath, [eslintBin, ...files], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
