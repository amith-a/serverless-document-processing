export interface ProcessingResult {
  documentId: string;
  processedAt: string;
  originalSizeBytes: number;
  lineCount: number;
  wordCount: number;
  characterCount: number;
}

export function processDocumentContent(
  documentId: string,
  content: Uint8Array,
): ProcessingResult {
  const text = new TextDecoder('utf-8').decode(content);
  const trimmed = text.trim();

  const lineCount = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const characterCount = text.length;

  return {
    documentId,
    processedAt: new Date().toISOString(),
    originalSizeBytes: content.byteLength,
    lineCount,
    wordCount,
    characterCount,
  };
}
