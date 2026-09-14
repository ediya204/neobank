import type { VirtualAccountRequest } from './core-api';

export function vaFeeBasis(request: VirtualAccountRequest) {
  return (
    request.openingFeeWaiverBasis ||
    (Number(request.openingFeeStandardUsd ?? request.openingFeeUsd) === 0
      ? 'BANK_FREE'
      : request.openingFeeBasis || 'STANDARD')
  );
}

export function vaFeeBasisLabel(request: VirtualAccountRequest) {
  return (
    {
      INTERNAL: '内部人员减免',
      SPECIAL: '特殊客户减免',
      BANK_FREE: '银行免费',
      STANDARD: '标准收费',
    }[vaFeeBasis(request)] || '标准收费'
  );
}
