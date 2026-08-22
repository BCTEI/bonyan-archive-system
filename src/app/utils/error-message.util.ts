// Shared mapper for turning a caught backend error into user-facing Arabic text.
// Messages that already contain Arabic (the normal case — main-process errors are
// Arabic) pass through verbatim; known English/technical strings are translated,
// and anything else falls back to the caller's Arabic fallback so raw backend
// text (e.g. 'Database not initialized', SQLite errors) never reaches the UI.
export function toUserErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const message = err.message;
  if (/[\u0600-\u06FF]/.test(message)) return message;
  const lower = message.toLowerCase();
  if (lower.includes('database not initialized')) return 'قاعدة البيانات غير مهيأة — أعد تشغيل التطبيق';
  if (lower.includes('in-memory fallback')) return 'وضع التخزين المؤقت لا يدعم هذه العملية';
  if (lower.includes('unique constraint')) return 'يوجد سجل مطابق — لا يمكن حفظ بيانات مكررة';
  if (lower.includes('unknown error')) return fallback;
  return fallback;
}
