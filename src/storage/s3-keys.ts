export function getUploadKey(documentId: string): string {
  validateDocumentId(documentId);
  return `uploads/${documentId}/original`;
}

export function getProcessedKey(documentId: string): string {
  validateDocumentId(documentId);
  return `processed/${documentId}/result`;
}

function validateDocumentId(documentId: string): void {
  if (
    !documentId ||
    typeof documentId !== 'string' ||
    documentId.trim() === ''
  ) {
    throw new Error('Document ID must be a non-empty string');
  }

  if (
    documentId.includes('/') ||
    documentId.includes('\\') ||
    documentId.includes('..')
  ) {
    throw new Error('Document ID contains invalid path characters');
  }
}
