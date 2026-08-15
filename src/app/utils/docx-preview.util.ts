import mammoth from 'mammoth';

// Converts a base64-encoded .docx (OOXML) file to HTML entirely client-side —
// mammoth reads the docx zip structure itself, no Electron/IPC round-trip needed.
// Legacy binary .doc is NOT supported by mammoth (it only understands the OOXML
// zip format), so callers should not route .doc files through this.
export async function convertDocxToHtml(base64: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  return result.value;
}
