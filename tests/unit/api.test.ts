import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { DocumentAlreadyExistsError } from '../../src/repositories/document.repository.js';
import type { DocumentRepository } from '../../src/repositories/document.repository.js';
import { DocumentService } from '../../src/services/document.service.js';
import type { S3StorageService } from '../../src/services/s3.service.js';
import type { Document } from '../../src/types/document.js';

describe('HTTP API', () => {
  let mockRepository: {
    create: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
  let mockS3Service: {
    getUploadUrl: ReturnType<typeof vi.fn>;
    getObject: ReturnType<typeof vi.fn>;
    putObject: ReturnType<typeof vi.fn>;
  };
  let documentService: DocumentService;
  let app: ReturnType<typeof createApp>;

  const sampleDocument: Document = {
    id: 'doc-123',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 2048,
    status: 'UPLOADED',
    s3Key: 'uploads/doc-123/original',
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
  };

  beforeEach(() => {
    mockRepository = {
      create: vi.fn().mockResolvedValue(sampleDocument),
      getById: vi.fn(),
    };
    mockS3Service = {
      getUploadUrl: vi.fn().mockResolvedValue({
        uploadUrl:
          'https://s3.amazonaws.com/bucket/uploads/doc-123/original?presigned',
        s3Key: 'uploads/doc-123/original',
      }),
      getObject: vi.fn(),
      putObject: vi.fn(),
    };

    documentService = new DocumentService(
      mockRepository as unknown as DocumentRepository,
      mockS3Service as unknown as S3StorageService,
      () => 'doc-123',
    );

    app = createApp(documentService);
  });

  describe('GET /', () => {
    it('returns service name', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Serverless Document Processing Pipeline');
    });
  });

  describe('POST /documents', () => {
    it('creates document and returns minimal response with 201 Created', async () => {
      const payload = {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };

      const res = await app.request('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const json = (await res.json()) as Record<string, unknown>;

      expect(json).toEqual({
        id: 'doc-123',
        s3Key: 'uploads/doc-123/original',
        uploadUrl:
          'https://s3.amazonaws.com/bucket/uploads/doc-123/original?presigned',
      });

      expect(json.status).toBeUndefined();
      expect(json.createdAt).toBeUndefined();
      expect(json.updatedAt).toBeUndefined();

      expect(mockRepository.create).toHaveBeenCalledTimes(1);
      expect(mockS3Service.getUploadUrl).toHaveBeenCalledWith(
        'doc-123',
        'application/pdf',
      );
    });

    it('returns 400 when request body is not a JSON object (e.g. array or primitive)', async () => {
      const nonObjectBodies = [
        JSON.stringify([1, 2, 3]),
        JSON.stringify('a plain string'),
        JSON.stringify(12345),
      ];

      for (const body of nonObjectBodies) {
        const res = await app.request('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: string };
        expect(json.error).toBe('Request body must be a JSON object');
      }

      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('returns 400 when filename is missing or whitespace only', async () => {
      const invalidFilenames = ['', '   ', undefined];

      for (const filename of invalidFilenames) {
        const res = await app.request('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename,
            contentType: 'application/pdf',
            size: 100,
          }),
        });

        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: string };
        expect(json.error).toContain('filename');
      }

      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('returns 400 when contentType is missing or whitespace only', async () => {
      const invalidContentTypes = ['', '   ', undefined];

      for (const contentType of invalidContentTypes) {
        const res = await app.request('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: 'invoice.pdf',
            contentType,
            size: 100,
          }),
        });

        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: string };
        expect(json.error).toContain('contentType');
      }

      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('returns 400 when size is missing', async () => {
      const res = await app.request('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain('size');
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('returns 400 when size is zero, negative, or not an integer', async () => {
      const invalidSizes = [0, -10, 12.5, '100'];

      for (const size of invalidSizes) {
        const res = await app.request('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: 'test.pdf',
            contentType: 'application/pdf',
            size,
          }),
        });

        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: string };
        expect(json.error).toContain('size');
      }

      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('returns 400 when request body is invalid JSON', async () => {
      const res = await app.request('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json{',
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Invalid JSON payload');
    });

    it('propagates error as safe 500 when S3 presigned URL generation fails', async () => {
      mockS3Service.getUploadUrl.mockRejectedValue(
        new Error('S3 internal KMS decryption failed secret-key-details'),
      );

      const res = await app.request('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 2048,
        }),
      });

      expect(res.status).toBe(500);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).toEqual({ error: 'Internal Server Error' });
      expect(json.uploadUrl).toBeUndefined();
      expect(json.s3Key).toBeUndefined();
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('propagates error and does not return upload info if DynamoDB creation fails', async () => {
      mockRepository.create.mockRejectedValue(
        new Error('DynamoDB write error'),
      );

      const res = await app.request('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 2048,
        }),
      });

      expect(res.status).toBe(500);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.error).toBe('Internal Server Error');
      expect(json.uploadUrl).toBeUndefined();
      expect(json.s3Key).toBeUndefined();
    });

    it('returns 409 Conflict when document ID collision occurs', async () => {
      mockRepository.create.mockRejectedValue(
        new DocumentAlreadyExistsError('doc-123'),
      );

      const res = await app.request('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 2048,
        }),
      });

      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Document already exists');
    });
  });

  describe('GET /documents/:id', () => {
    it('returns document when it exists', async () => {
      mockRepository.getById.mockResolvedValue(sampleDocument);

      const res = await app.request('/documents/doc-123');

      expect(res.status).toBe(200);
      const json = (await res.json()) as Document;
      expect(json).toEqual(sampleDocument);
      expect(mockRepository.getById).toHaveBeenCalledWith('doc-123');
    });

    it('trims leading and trailing whitespace from document ID before repository lookup', async () => {
      mockRepository.getById.mockResolvedValue(sampleDocument);

      const res = await app.request('/documents/%20doc-123%20');

      expect(res.status).toBe(200);
      const json = (await res.json()) as Document;
      expect(json).toEqual(sampleDocument);
      expect(mockRepository.getById).toHaveBeenCalledWith('doc-123');
    });

    it('returns 400 when document ID is whitespace only', async () => {
      const res = await app.request('/documents/%20%20');

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Document ID must be a non-empty string');
      expect(mockRepository.getById).not.toHaveBeenCalled();
    });

    it('returns 404 when document does not exist', async () => {
      mockRepository.getById.mockResolvedValue(null);

      const res = await app.request('/documents/doc-404');

      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Document not found');
    });

    it('returns safe 500 response with exactly { error: "Internal Server Error" } when repository throws an error', async () => {
      mockRepository.getById.mockRejectedValue(
        new Error('DynamoDB timeout with sensitive internal details'),
      );

      const res = await app.request('/documents/doc-123');

      expect(res.status).toBe(500);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).toEqual({ error: 'Internal Server Error' });
    });
  });
});
