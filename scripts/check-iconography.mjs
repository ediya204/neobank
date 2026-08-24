import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'src');
const catalogPath = path.join(sourceRoot, 'theme/iconography.ts');

const deprecatedIcons = new Set([
  'solar:add-circle-bold',
  'solar:arrow-down-bold',
  'solar:arrow-up-bold',
  'solar:card-send-bold-duotone',
  'solar:copy-bold',
  'solar:copy-bold-duotone',
  'solar:copy-outline',
  'solar:download-minimalistic-bold',
  'solar:download-square-bold-duotone',
  'solar:eye-bold',
  'solar:eye-closed-bold',
  'solar:history-bold',
  'solar:home-2-bold',
  'solar:inbox-in-bold-duotone',
  'solar:logout-2-bold-duotone',
  'solar:outbox-bold-duotone',
  'solar:pen-bold-duotone',
  'solar:pen-new-square-bold-duotone',
  'solar:refresh-bold',
  'solar:settings-linear',
  'solar:transfer-horizontal-bold',
  'solar:upload-minimalistic-bold',
  'solar:upload-square-bold-duotone',
  'solar:user-id-bold',
  'solar:user-plus-bold',
  'solar:user-plus-rounded-bold-duotone',
  'solar:wallet-bold',
  'solar:wallet-bold-duotone',
]);

const allowedProductPrefixes = ['solar:', 'circle-flags:', 'cryptocurrency-color:', 'flagpack:'];
const productPathPattern =
  /^src\/(?:layouts|pages|sections\/auth\/jwt|sections\/portal)\//;
const iconPattern = /['"]([a-z0-9-]+:[a-zA-Z0-9_-]+)['"]/g;

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(entryPath);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
    })
  );
  return nested.flat();
}

const files = await listSourceFiles(sourceRoot);
const violations = [];
let iconReferences = 0;

for (const file of files) {
  if (file === catalogPath) continue;
  const relativePath = path.relative(projectRoot, file);
  const source = await readFile(file, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    for (const match of line.matchAll(iconPattern)) {
      const icon = match[1];
      iconReferences += 1;
      if (deprecatedIcons.has(icon)) {
        violations.push(`${relativePath}:${index + 1} deprecated ${icon}`);
      }
      if (
        productPathPattern.test(relativePath) &&
        !allowedProductPrefixes.some((prefix) => icon.startsWith(prefix))
      ) {
        violations.push(`${relativePath}:${index + 1} unsupported product icon set ${icon}`);
      }
    }
  });
}

if (violations.length) {
  console.error(`Iconography check failed with ${violations.length} violation(s):`);
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log(`Iconography check passed: ${files.length} files, ${iconReferences} icon references.`);
