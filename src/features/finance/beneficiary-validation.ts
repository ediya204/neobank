const swiftBicPattern = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

export function normalizeSwiftBic(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidOptionalSwiftBic(value: string): boolean {
  const normalized = normalizeSwiftBic(value);
  return normalized === '' || swiftBicPattern.test(normalized);
}
