import { describe, expect, it } from 'vitest';
import { createDocument } from '../../src/types/document.js';
import type { CreateDocumentParams } from '../../src/types/document.js';

describe('createDocument', () => {
  const params: CreateDocumentParams = {
    id: 'doc-123',
    filename: 'test.pdf',
    contentType: 'application/pdf',
    size: 1024,
    s3Key: 'uploads/doc-123/original',
  };

  it('maps the supplied parameters correctly', () => {
    const doc = createDocument(params);

    expect(doc.id).toBe(params.id);
    expect(doc.filename).toBe(params.filename);
    expect(doc.contentType).toBe(params.contentType);
    expect(doc.size).toBe(params.size);
    expect(doc.s3Key).toBe(params.s3Key);
  });

  it('always sets initial status to UPLOADED', () => {
    const doc = createDocument(params);

    expect(doc.status).toBe('UPLOADED');
  });

  it('generates valid ISO timestamps for createdAt and updatedAt', () => {
    const before = new Date().toISOString();
    const doc = createDocument(params);
    const after = new Date().toISOString();

    expect(new Date(doc.createdAt).toISOString()).toBe(doc.createdAt);
    expect(new Date(doc.updatedAt).toISOString()).toBe(doc.updatedAt);
    expect(doc.createdAt >= before && doc.createdAt <= after).toBe(true);
    expect(doc.updatedAt >= before && doc.updatedAt <= after).toBe(true);
  });

  it('initializes createdAt and updatedAt correctly to the same creation timestamp', () => {
    const doc = createDocument(params);

    expect(doc.createdAt).toBe(doc.updatedAt);
  });
});
