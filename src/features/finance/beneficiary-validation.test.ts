import { isValidOptionalSwiftBic, normalizeSwiftBic } from './beneficiary-validation';

describe('beneficiary validation', () => {
  it('normalizes spaces and lowercase characters in SWIFT/BIC', () => {
    expect(normalizeSwiftBic(' bkch hk hh ')).toBe('BKCHHKHH');
  });

  it('accepts an empty, 8-character, or 11-character SWIFT/BIC', () => {
    expect(isValidOptionalSwiftBic('')).toBe(true);
    expect(isValidOptionalSwiftBic('BKCHHKHH')).toBe(true);
    expect(isValidOptionalSwiftBic('BKCHHKHHXXX')).toBe(true);
  });

  it('rejects a 9-character or structurally invalid SWIFT/BIC', () => {
    expect(isValidOptionalSwiftBic('ASKDL1213')).toBe(false);
    expect(isValidOptionalSwiftBic('BKCH12HH')).toBe(false);
  });
});
