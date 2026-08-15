import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const conflictCopyPattern = / \d+(?=\.|$)/;
const ignoredDirectories = new Set(['.git', '.learnings']);
const findings = [];
const MAX_FINDINGS = 50;

function addFinding(message) {
  if (findings.length < MAX_FINDINGS) findings.push(message);
}

function scanConflictCopies() {
  const pending = [projectRoot];

  while (pending.length && findings.length < MAX_FINDINGS) {
    const current = pending.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      addFinding(`无法读取 ${relative(projectRoot, current) || '.'}: ${error.message}`);
      continue;
    }

    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const absolutePath = `${current}/${entry.name}`;
      const displayPath = relative(projectRoot, absolutePath);

      if (conflictCopyPattern.test(entry.name)) {
        addFinding(`发现文件冲突副本: ${displayPath}`);
      }

      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(absolutePath);
      if (findings.length >= MAX_FINDINGS) break;
    }
  }
}

function scanDatalessSources() {
  if (process.platform !== 'darwin') return;

  const sourceRoots = ['src', 'scripts', 'server/src', 'server/prisma'];
  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = `${projectRoot}/${sourceRoot}`;
    if (!existsSync(absoluteRoot)) continue;

    try {
      const output = execFileSync(
        '/usr/bin/find',
        [absoluteRoot, '-type', 'f', '-flags', '+dataless', '-print'],
        { encoding: 'utf8' }
      );
      for (const filePath of output.split('\n').filter(Boolean)) {
        addFinding(`源文件尚未本地化: ${relative(projectRoot, filePath)}`);
      }
    } catch (error) {
      addFinding(`无法检查 ${sourceRoot} 的本地化状态: ${error.message}`);
    }
  }
}

function scanFileProviderLocation() {
  if (process.platform !== 'darwin') return;

  let current = projectRoot;
  while (true) {
    try {
      execFileSync('/usr/bin/xattr', ['-p', 'com.apple.file-provider-domain-id', current], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      addFinding(`项目位于 macOS File Provider 同步目录内: ${current}`);
      return;
    } catch {
      // xattr exits non-zero when this ancestor is not managed by File Provider.
    }

    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function scanCriticalInstallLinks() {
  const installChecks = [
    {
      directory: 'node_modules',
      required: [
        'node_modules/.bin/eslint',
        'node_modules/.bin/prettier',
        'node_modules/.bin/react-scripts',
        'node_modules/.bin/tsc',
        'node_modules/.package-lock.json',
      ],
    },
    {
      directory: 'server/node_modules',
      required: [
        'server/node_modules/.bin/prisma',
        'server/node_modules/.bin/tsc',
        'server/node_modules/.package-lock.json',
      ],
    },
  ];

  for (const check of installChecks) {
    if (!existsSync(`${projectRoot}/${check.directory}`)) continue;
    for (const requiredPath of check.required) {
      if (!existsSync(`${projectRoot}/${requiredPath}`)) {
        addFinding(`依赖安装不完整，缺少: ${requiredPath}`);
      }
    }
  }
}

scanConflictCopies();
scanDatalessSources();
scanFileProviderLocation();
scanCriticalInstallLinks();

if (findings.length) {
  console.error('Workspace integrity check failed.');
  for (const finding of findings) console.error(`- ${finding}`);
  console.error('请先隔离冲突副本或下载源文件，再启动/构建项目。');
  process.exit(1);
}

console.log(`Workspace integrity check passed: ${basename(projectRoot)}`);
