import { TextEncoder } from 'util';

import { createDepositQrCode } from './deposit-qr';

describe('createDepositQrCode', () => {
  beforeAll(() => {
    Object.defineProperty(global, 'TextEncoder', { value: TextEncoder });
  });

  it('creates a local PNG data URL for a TRON deposit address', async () => {
    const result = await createDepositQrCode('TFbXZoaXDCWq318W2HghRmrXktCvCzoX9K');

    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects an empty deposit address', async () => {
    await expect(createDepositQrCode('')).rejects.toThrow('deposit_address_required');
  });
});
