import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/api/app.js';
import type { DocumentRepository } from '../../src/repositories/document.repository.js';
import { DocumentService } from '../../src/services/document.service.js';
import type { S3StorageService } from '../../src/services/s3.service.js';
import {
  getProcessedKey,
  getUploadKey,
  parseDocumentIdFromUploadKey,
} from '../../src/storage/s3-keys.js';

describe('Security Controls', () => {
  describe('S3 Key Sanitization & Path Traversal Prevention', () => {
    it('rejects path traversal sequences in getUploadKey', () => {
      const maliciousIds = [
        '../doc-123',
        '..\\doc-123',
        '../../etc/passwd',
        'doc/123',
        'doc\\123',
        'nested/path/traversal',
        '..',
      ];

      for (const id of maliciousIds) {
        expect(() => getUploadKey(id)).toThrow(
          'Document ID contains invalid path characters',
        );
      }
    });

    it('rejects path traversal sequences in getProcessedKey', () => {
      const maliciousIds = [
        '../result',
        '..\\result',
        'foo/bar',
        'foo\\bar',
        '..',
      ];

      for (const id of maliciousIds) {
        expect(() => getProcessedKey(id)).toThrow(
          'Document ID contains invalid path characters',
        );
      }
    });

    it('returns null when parsing document ID from traversal or non-matching S3 keys', () => {
      expect(
        parseDocumentIdFromUploadKey('uploads/../secret/original'),
      ).toBeNull();
      expect(
        parseDocumentIdFromUploadKey('uploads/sub/dir/id/original'),
      ).toBeNull();
      expect(parseDocumentIdFromUploadKey('uploads//original')).toBeNull();
      expect(
        parseDocumentIdFromUploadKey('processed/doc-123/result'),
      ).toBeNull();
      expect(
        parseDocumentIdFromUploadKey('uploads/doc-123/malware'),
      ).toBeNull();
    });

    it('ensures user-supplied filename does not influence S3 key structure', async () => {
      const fixedId = 'doc-sec-test';
      const expectedS3Key = getUploadKey(fixedId);

      const mockRepository: {
        create: ReturnType<typeof vi.fn>;
        getById: ReturnType<typeof vi.fn>;
      } = {
        create: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn(),
      };
      const mockS3Service: {
        getUploadUrl: ReturnType<typeof vi.fn>;
        getObject: ReturnType<typeof vi.fn>;
        putObject: ReturnType<typeof vi.fn>;
      } = {
        getUploadUrl: vi.fn().mockResolvedValue({
          uploadUrl: `https://bucket.s3.amazonaws.com/${expectedS3Key}?signed`,
          s3Key: expectedS3Key,
        }),
        getObject: vi.fn(),
        putObject: vi.fn(),
      };

      const documentService = new DocumentService(
        mockRepository as unknown as DocumentRepository,
        mockS3Service as unknown as S3StorageService,
        () => fixedId,
      );

      const maliciousFilename = '../../../../etc/passwd';
      const result = await documentService.createDocument({
        filename: maliciousFilename,
        contentType: 'text/plain',
        size: 100,
      });

      expect(result.s3Key).toBe('uploads/doc-sec-test/original');
      expect(result.s3Key).not.toContain(maliciousFilename);
      expect(result.s3Key).not.toContain('..');
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: fixedId,
          filename: maliciousFilename,
          s3Key: expectedS3Key,
        }),
      );
    });
  });

  describe('Information Leakage & Error Sanitization', () => {
    it('masks internal exceptions without exposing sensitive database or infrastructure details', async () => {
      const mockRepository = {
        create: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'FATAL: DynamoDB cluster connection failed at 10.0.1.25:8000 with secret credentials',
            ),
          ),
        getById: vi.fn(),
      };
      const mockS3Service = {
        getUploadUrl: vi.fn().mockResolvedValue({
          uploadUrl: 'https://presigned-url',
          s3Key: 'uploads/doc-1/original',
        }),
        getObject: vi.fn(),
        putObject: vi.fn(),
      };

      const documentService = new DocumentService(
        mockRepository as unknown as DocumentRepository,
        mockS3Service as unknown as S3StorageService,
      );

      const app = createApp(documentService);

      const response = await app.request('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'test.pdf',
          contentType: 'application/pdf',
          size: 1024,
        }),
      });

      expect(response.status).toBe(500);
      const body = (await response.json()) as { error?: string };
      expect(body).toEqual({ error: 'Internal Server Error' });
      expect(JSON.stringify(body)).not.toContain('DynamoDB');
      expect(JSON.stringify(body)).not.toContain('secret credentials');
      expect(JSON.stringify(body)).not.toContain('10.0.1.25');
    });
  });
});
