import mammoth from 'mammoth';
import DOMPurify from 'dompurify';

// Converts a base64-encoded .docx (OOXML) file to HTML entirely client-side —
// mammoth reads the docx zip structure itself, no Electron/IPC round-trip needed.
// Legacy binary .doc is NOT supported by mammoth (it only understands the OOXML
// zip format), so callers should not route .doc files through this.
//
// The output is sanitized here, once, because the source bytes come from a
// user-uploaded attachment: mammoth passes hyperlinks through unfiltered, so a
// crafted docx could carry javascript:/data: URLs or event handlers into any
// [innerHTML] binding or print window that renders the result.
export async function convertDocxToHtml(base64: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  return DOMPurify.sanitize(result.value, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  });
}
