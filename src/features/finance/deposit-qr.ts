import QRCode from 'qrcode';

const depositQrOptions = {
  errorCorrectionLevel: 'M' as const,
  margin: 2,
  width: 340,
  color: {
    dark: '#172B4D',
    light: '#FFFFFF',
  },
};

export function createDepositQrCode(address: string) {
  if (!address) return Promise.reject(new Error('deposit_address_required'));
  return QRCode.toDataURL(address, depositQrOptions);
}
