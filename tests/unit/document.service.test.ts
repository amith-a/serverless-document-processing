import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRepository } from '../../src/repositories/document.repository.js';
import { DocumentService } from '../../src/services/document.service.js';
import type { S3StorageService } from '../../src/services/s3.service.js';
import type { Document } from '../../src/types/document.js';

describe('DocumentService - Isolated Unit Tests', () => {
  let mockRepository: {
    create: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
  let mockS3Service: {
    getUploadUrl: ReturnType<typeof vi.fn>;
    getObject: ReturnType<typeof vi.fn>;
    putObject: ReturnType<typeof vi.fn>;
  };
  let deterministicIdGenerator: () => string;
  let service: DocumentService;

  beforeEach(() => {
    mockRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn(),
    };
    mockS3Service = {
      getUploadUrl: vi.fn().mockResolvedValue({
        uploadUrl:
          'https://s3.amazonaws.com/bucket/uploads/doc-fixed-123/original?presigned',
        s3Key: 'uploads/doc-fixed-123/original',
      }),
      getObject: vi.fn(),
      putObject: vi.fn(),
    };
    deterministicIdGenerator = () => 'doc-fixed-123';

    service = new DocumentService(
      mockRepository as unknown as DocumentRepository,
      mockS3Service as unknown as S3StorageService,
      deterministicIdGenerator,
    );
  });

  describe('createDocument()', () => {
    it('creates document with deterministic ID, presigned URL, domain entity, and minimal output', async () => {
      const input = {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };

      const beforeTime = new Date().toISOString();
      const result = await service.createDocument(input);
      const afterTime = new Date().toISOString();

      // Verify S3 getUploadUrl call
      expect(mockS3Service.getUploadUrl).toHaveBeenCalledTimes(1);
      expect(mockS3Service.getUploadUrl).toHaveBeenCalledWith(
        'doc-fixed-123',
        'application/pdf',
      );

      // Verify repository.create call
      expect(mockRepository.create).toHaveBeenCalledTimes(1);
      const createdDoc = mockRepository.create.mock.calls[0][0] as Document;

      expect(createdDoc.id).toBe('doc-fixed-123');
      expect(createdDoc.filename).toBe('invoice.pdf');
      expect(createdDoc.contentType).toBe('application/pdf');
      expect(createdDoc.size).toBe(2048);
      expect(createdDoc.s3Key).toBe('uploads/doc-fixed-123/original');
      expect(createdDoc.status).toBe('UPLOADED');
      expect(createdDoc.createdAt >= beforeTime).toBe(true);
      expect(createdDoc.createdAt <= afterTime).toBe(true);
      expect(createdDoc.updatedAt).toBe(createdDoc.createdAt);

      // Verify minimal return value contract
      expect(result).toEqual({
        id: 'doc-fixed-123',
        s3Key: 'uploads/doc-fixed-123/original',
        uploadUrl:
          'https://s3.amazonaws.com/bucket/uploads/doc-fixed-123/original?presigned',
      });

      // Verify no extra domain fields exposed
      const record = result as unknown as Record<string, unknown>;
      expect(record.status).toBeUndefined();
      expect(record.createdAt).toBeUndefined();
      expect(record.updatedAt).toBeUndefined();
      expect(record.processedS3Key).toBeUndefined();
    });

    it('propagates S3 presigned URL generation error and does not call repository.create', async () => {
      const s3Error = new Error('S3 service unavailable');
      mockS3Service.getUploadUrl.mockRejectedValue(s3Error);

      const input = {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };

      await expect(service.createDocument(input)).rejects.toThrow(
        'S3 service unavailable',
      );
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('propagates DynamoDB creation error and does not return upload information', async () => {
      const ddbError = new Error('DynamoDB conditional write failed');
      mockRepository.create.mockRejectedValue(ddbError);

      const input = {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };

      await expect(service.createDocument(input)).rejects.toThrow(
        'DynamoDB conditional write failed',
      );
    });
  });

  describe('getDocument()', () => {
    const sampleDoc: Document = {
      id: 'doc-fixed-123',
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 2048,
      status: 'UPLOADED',
      s3Key: 'uploads/doc-fixed-123/original',
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:00:00.000Z',
    };

    it('returns document when document is found in repository', async () => {
      mockRepository.getById.mockResolvedValue(sampleDoc);

      const result = await service.getDocument('doc-fixed-123');

      expect(mockRepository.getById).toHaveBeenCalledTimes(1);
      expect(mockRepository.getById).toHaveBeenCalledWith('doc-fixed-123');
      expect(result).toEqual(sampleDoc);
    });

    it('returns null when document is not found in repository', async () => {
      mockRepository.getById.mockResolvedValue(null);

      const result = await service.getDocument('doc-missing-404');

      expect(mockRepository.getById).toHaveBeenCalledTimes(1);
      expect(mockRepository.getById).toHaveBeenCalledWith('doc-missing-404');
      expect(result).toBeNull();
    });

    it('propagates error when repository throws an error', async () => {
      mockRepository.getById.mockRejectedValue(
        new Error('DynamoDB read failure'),
      );

      await expect(service.getDocument('doc-fixed-123')).rejects.toThrow(
        'DynamoDB read failure',
      );
    });
  });
});
