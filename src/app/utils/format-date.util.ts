// Shared date formatting — replaces five copy-pasted formatDate implementations
// that had drifted between ar-LY and ar-SA locales. ar-LY is the standard here
// (the app is built for a Libyan organization); the toLocaleString variant is
// kept for callers that need date+time.
export function formatDate(timestamp: number | string | null | undefined): string {
  if (!timestamp) return '—';
  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
  return date.toLocaleDateString('ar-LY', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatDateTime(timestamp: number | string | null | undefined): string {
  if (!timestamp) return '—';
  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
  return date.toLocaleString('ar-LY', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
