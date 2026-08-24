export function isFinancialAccountingProcessingEnabled(value?: string) {
  return value?.trim().toLowerCase() === 'true';
}
