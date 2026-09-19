export function getUploadKey(documentId: string): string {
  validateDocumentId(documentId);
  return `uploads/${documentId}/original`;
}

export function getProcessedKey(documentId: string): string {
  validateDocumentId(documentId);
  return `processed/${documentId}/result`;
}

export function parseDocumentIdFromUploadKey(key: string): string | null {
  if (!key || typeof key !== 'string') {
    return null;
  }
  const match = /^uploads\/([^/]+)\/original$/.exec(key);
  if (!match?.[1]) {
    return null;
  }
  const documentId = match[1];
  try {
    validateDocumentId(documentId);
    return documentId;
  } catch {
    return null;
  }
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
