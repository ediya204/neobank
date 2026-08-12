import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const source = await fs.readFile(
  path.join(projectRoot, 'src', 'data', 'supported-country-calling-codes.ts'),
  'utf8'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rows = [...source.matchAll(
  /iso2: "([A-Z]{2})".*?callingCode: "(\+\d+)"/g
)].map((match) => ({ iso2: match[1], callingCode: match[2] }));
const iso2Values = new Set(rows.map((row) => row.iso2));
const callingCodeValues = new Set(rows.map((row) => row.callingCode));

assert(rows.length === 241, `Expected 241 supported rows, received ${rows.length}.`);
assert(iso2Values.size === rows.length, 'Country or territory identifiers are duplicated.');
assert(
  callingCodeValues.size === 203,
  `Expected 203 unique calling codes, received ${callingCodeValues.size}.`
);
assert(
  rows.every((row) => /^\+\d{1,3}$/.test(row.callingCode)),
  'A calling code is outside the E.164 country-code format.'
);
assert(
  rows.some((row) => row.iso2 === 'SY' && row.callingCode === '+963'),
  'Syria (+963) is missing from the supported list.'
);
for (const excludedIso2 of ['CU', 'IR', 'KP']) {
  assert(!iso2Values.has(excludedIso2), `${excludedIso2} must remain excluded.`);
}
for (const sharedCallingCode of ['+1', '+7', '+44']) {
  assert(
    rows.filter((row) => row.callingCode === sharedCallingCode).length > 1,
    `${sharedCallingCode} must retain its shared-country entries.`
  );
}

console.log(
  `Country calling-code check passed: ${rows.length} countries/territories, ` +
    `${callingCodeValues.size} unique calling codes.`
);
