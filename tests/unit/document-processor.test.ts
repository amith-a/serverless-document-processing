import { describe, expect, it } from 'vitest';
import { processDocumentContent } from '../../src/services/document-processor.js';

describe('document-processor', () => {
  it('processes empty content correctly', () => {
    const emptyBytes = new Uint8Array(0);
    const result = processDocumentContent('doc-empty', emptyBytes);

    expect(result.documentId).toBe('doc-empty');
    expect(result.originalSizeBytes).toBe(0);
    expect(result.lineCount).toBe(0);
    expect(result.wordCount).toBe(0);
    expect(result.characterCount).toBe(0);
    expect(Date.parse(result.processedAt)).not.toBeNaN();
  });

  it('processes single-line text correctly', () => {
    const content = new TextEncoder().encode('Hello world from serverless!');
    const result = processDocumentContent('doc-1', content);

    expect(result.documentId).toBe('doc-1');
    expect(result.originalSizeBytes).toBe(content.byteLength);
    expect(result.lineCount).toBe(1);
    expect(result.wordCount).toBe(4);
    expect(result.characterCount).toBe('Hello world from serverless!'.length);
  });

  it('processes multi-line text with whitespace variations', () => {
    const multiLine = 'Line 1\nLine 2 is longer\r\nLine 3   with   spaces\n';
    const content = new TextEncoder().encode(multiLine);
    const result = processDocumentContent('doc-2', content);

    expect(result.documentId).toBe('doc-2');
    expect(result.originalSizeBytes).toBe(content.byteLength);
    expect(result.lineCount).toBe(4);
    expect(result.wordCount).toBe(10);
    expect(result.characterCount).toBe(multiLine.length);
  });
});
