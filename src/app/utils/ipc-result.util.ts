// Shared unwrap for the { success, error?, ... } envelope that every main-process
// IPC handler returns. Collapses the repeated
//   if (!result.success) throw new Error(result.error ?? '...');
// boilerplate that was copy-pasted across the renderer services.
export function unwrap<T extends { success: boolean; error?: string }>(result: T, fallback: string): T {
  if (!result.success) throw new Error(result.error ?? fallback);
  return result;
}
