export function truncateIdentifier(value: string, leading = 10, trailing = 6) {
  if (value.length <= leading + trailing + 1) return value;
  return `${value.slice(0, leading)}…${value.slice(-trailing)}`;
}
