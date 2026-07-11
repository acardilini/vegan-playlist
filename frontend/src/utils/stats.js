// Round a live count down to the nearest hundred for display ("1,342" → "1,300+")
export function roundedStat(value) {
  if (!value) return '…';
  return `${(Math.floor(value / 100) * 100).toLocaleString()}+`;
}
