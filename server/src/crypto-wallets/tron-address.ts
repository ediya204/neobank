import { createHash } from 'node:crypto';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const alphabetIndex = new Map([...alphabet].map((character, index) => [character, index]));

function decodeBase58(value: string) {
  let decoded = 0n;
  for (const character of value) {
    const digit = alphabetIndex.get(character);
    if (digit === undefined) return null;
    decoded = decoded * 58n + BigInt(digit);
  }

  let hex = decoded.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
  const leadingZeroes = value.match(/^1*/)?.[0].length || 0;
  return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

export function isValidTronAddress(value: string) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;
  const decoded = decodeBase58(value);
  if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) return false;
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const firstHash = createHash('sha256').update(payload).digest();
  const expected = createHash('sha256').update(firstHash).digest().subarray(0, 4);
  return checksum.equals(expected);
}
