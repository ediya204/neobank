import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const languageDirectory = path.join(projectRoot, 'src', 'locales', 'langs');
const sourceDirectory = path.join(projectRoot, 'src');
const portalPageDirectory = path.join(sourceDirectory, 'pages', 'portal');
const portalLayoutPath = path.join(sourceDirectory, 'layouts', 'portal', 'layout.tsx');
const namespaceFiles = {
  translations: ['en.json', 'cn.json'],
  common: ['common.en.json', 'common.cn.json'],
  portal: ['portal.en.json', 'portal.cn.json'],
  admin: ['admin.en.json', 'admin.cn.json'],
  operations: ['operations.en.json', 'operations.cn.json'],
};

function flatten(value, prefix = '', entries = new Map()) {
  Object.entries(value).forEach(([key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, nextKey, entries);
    } else {
      entries.set(nextKey, String(child ?? ''));
    }
  });
  return entries;
}

function interpolationTokens(value) {
  return [...value.matchAll(/\{\{\s*([^},\s]+).*?\}\}/g)].map((match) => match[1]).sort();
}

function sourceFiles(directory, files = []) {
  fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        sourceFiles(entryPath, files);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(entryPath);
      }
    });

  return files;
}

function unwrapExpression(node) {
  let value = node;

  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    (ts.isSatisfiesExpression && ts.isSatisfiesExpression(value))
  ) {
    value = value.expression;
  }

  return value;
}

function staticTranslationKeys(node, keys = []) {
  const value = unwrapExpression(node);

  if (ts.isStringLiteralLike(value)) {
    keys.push(value);
  } else if (ts.isConditionalExpression(value)) {
    staticTranslationKeys(value.whenTrue, keys);
    staticTranslationKeys(value.whenFalse, keys);
  }

  return keys;
}

let hasErrors = false;
let portalResources;

for (const [namespace, [enFile, cnFile]] of Object.entries(namespaceFiles)) {
  const enPath = path.join(languageDirectory, enFile);
  const cnPath = path.join(languageDirectory, cnFile);
  const enResource = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const cnResource = JSON.parse(fs.readFileSync(cnPath, 'utf8'));
  const en = flatten(enResource);
  const cn = flatten(cnResource);
  const allKeys = [...new Set([...en.keys(), ...cn.keys()])].sort();

  if (namespace === 'portal') {
    portalResources = { en: enResource, cn: cnResource };
  }

  for (const key of allKeys) {
    if (!en.has(key) || !cn.has(key)) {
      hasErrors = true;
      process.stderr.write(
        `[${namespace}] Missing ${!en.has(key) ? 'English' : 'Chinese'} key: ${key}\n`
      );
      continue;
    }

    if (!en.get(key)?.trim() || !cn.get(key)?.trim()) {
      hasErrors = true;
      process.stderr.write(`[${namespace}] Empty translation: ${key}\n`);
    }

    const enTokens = interpolationTokens(en.get(key));
    const cnTokens = interpolationTokens(cn.get(key));
    if (enTokens.join('|') !== cnTokens.join('|')) {
      hasErrors = true;
      process.stderr.write(`[${namespace}] Interpolation mismatch: ${key}\n`);
    }
  }

  process.stdout.write(`[${namespace}] ${allKeys.length} bilingual keys checked\n`);
}

const portalSourceReferences = new Map();
let portalModuleKeysChecked = 0;
let portalHardcodedViolations = 0;

function isPortalClientSurface(sourcePath) {
  return sourcePath === portalLayoutPath || sourcePath.startsWith(`${portalPageDirectory}${path.sep}`);
}

function containsHan(value) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}

function isInsidePortalTextCall(node) {
  let current = node.parent;

  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === 'portalText'
    ) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function hasFunctionAncestor(node) {
  let current = node.parent;

  while (current) {
    if (ts.isFunctionLike(current)) return true;
    current = current.parent;
  }

  return false;
}

for (const sourcePath of sourceFiles(sourceDirectory)) {
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  let usesPortalNamespace = false;

  function findPortalNamespace(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useTranslation' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === 'portal'
    ) {
      usesPortalNamespace = true;
    }

    ts.forEachChild(node, findPortalNamespace);
  }

  findPortalNamespace(sourceFile);

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'portalText' ||
        (usesPortalNamespace && node.expression.text === 'translate')) &&
      node.arguments[0]
    ) {
      for (const keyNode of staticTranslationKeys(node.arguments[0])) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(keyNode.getStart(sourceFile)).line + 1;
        const reference = {
          caller: node.expression.text,
          file: path.relative(projectRoot, sourcePath),
          line,
        };
        const references = portalSourceReferences.get(keyNode.text) || [];
        references.push(reference);
        portalSourceReferences.set(keyNode.text, references);
      }
    }

    if (isPortalClientSurface(sourcePath)) {
      let literalValue;
      if (ts.isJsxText(node)) literalValue = node.getText(sourceFile);
      else if (ts.isStringLiteralLike(node)) literalValue = node.text;

      if (literalValue && containsHan(literalValue) && !isInsidePortalTextCall(node)) {
        const isAllowedModuleKey =
          !ts.isJsxText(node) &&
          !hasFunctionAncestor(node) &&
          Object.prototype.hasOwnProperty.call(portalResources.cn, literalValue) &&
          Object.prototype.hasOwnProperty.call(portalResources.en, literalValue);

        if (isAllowedModuleKey) {
          portalModuleKeysChecked += 1;
        } else {
          portalHardcodedViolations += 1;
          hasErrors = true;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          process.stderr.write(
            `[portal hardcoded] Route Chinese copy through portalText: ` +
              `${path.relative(projectRoot, sourcePath)}:${line}\n`
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

for (const [key, references] of [...portalSourceReferences.entries()].sort(([a], [b]) =>
  a.localeCompare(b)
)) {
  const missingEnglish = !Object.prototype.hasOwnProperty.call(portalResources.en, key);
  const missingChinese = !Object.prototype.hasOwnProperty.call(portalResources.cn, key);

  if (missingEnglish || missingChinese) {
    hasErrors = true;
    const firstReference = references[0];
    const missingLanguages = [missingEnglish && 'English', missingChinese && 'Chinese']
      .filter(Boolean)
      .join(' and ');
    process.stderr.write(
      `[portal source] Missing ${missingLanguages} key: ${key} ` +
        `(${firstReference.file}:${firstReference.line}, ${firstReference.caller})\n`
    );
  }
}

process.stdout.write(
  `[portal source] ${portalSourceReferences.size} static translate/portalText keys checked\n`
);
process.stdout.write(
  `[portal hardcoded] ${portalHardcodedViolations} unlocalized literals; ` +
    `${portalModuleKeysChecked} bilingual module keys checked\n`
);

if (hasErrors) process.exit(1);
