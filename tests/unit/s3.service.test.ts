import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S3StorageService } from '../../src/services/s3.service.js';
import type { PresignerFn } from '../../src/services/s3.service.js';
import { getProcessedKey, getUploadKey } from '../../src/storage/s3-keys.js';

describe('S3 Keys', () => {
  describe('getUploadKey', () => {
    it('generates the deterministic upload key', () => {
      expect(getUploadKey('doc-123')).toBe('uploads/doc-123/original');
    });

    it('rejects empty or whitespace document ID', () => {
      expect(() => getUploadKey('')).toThrow(
        'Document ID must be a non-empty string',
      );
      expect(() => getUploadKey('   ')).toThrow(
        'Document ID must be a non-empty string',
      );
    });

    it('rejects document ID with path traversal or slash characters', () => {
      expect(() => getUploadKey('../doc-123')).toThrow(
        'Document ID contains invalid path characters',
      );
      expect(() => getUploadKey('folder/doc-123')).toThrow(
        'Document ID contains invalid path characters',
      );
      expect(() => getUploadKey('folder\\doc-123')).toThrow(
        'Document ID contains invalid path characters',
      );
    });
  });

  describe('getProcessedKey', () => {
    it('generates the deterministic processed key', () => {
      expect(getProcessedKey('doc-123')).toBe('processed/doc-123/result');
    });

    it('rejects empty or whitespace document ID', () => {
      expect(() => getProcessedKey('')).toThrow(
        'Document ID must be a non-empty string',
      );
    });
  });
});

describe('S3StorageService', () => {
  const s3Mock = mockClient(S3Client);
  const bucketName = 'test-documents-bucket';
  const mockPresign = vi.fn<PresignerFn>();
  let service: S3StorageService;

  beforeEach(() => {
    s3Mock.reset();
    mockPresign.mockReset();
    service = new S3StorageService(
      s3Mock as unknown as S3Client,
      bucketName,
      mockPresign,
    );
  });

  describe('getUploadUrl', () => {
    it('generates presigned PUT URL for deterministic key and content type', async () => {
      mockPresign.mockResolvedValue(
        'https://s3.amazonaws.com/bucket/upload-url',
      );

      const result = await service.getUploadUrl(
        'doc-123',
        'application/pdf',
        600,
      );

      expect(result).toEqual({
        uploadUrl: 'https://s3.amazonaws.com/bucket/upload-url',
        s3Key: 'uploads/doc-123/original',
      });

      expect(mockPresign).toHaveBeenCalledTimes(1);
      const [calledClient, calledCommand, calledOptions] =
        mockPresign.mock.calls[0];
      expect(calledClient).toBeDefined();
      expect(calledCommand).toBeInstanceOf(PutObjectCommand);
      expect(calledCommand.input).toEqual({
        Bucket: bucketName,
        Key: 'uploads/doc-123/original',
        ContentType: 'application/pdf',
      });
      expect(calledOptions).toEqual({ expiresIn: 600 });
    });

    it('rejects invalid or empty content type', async () => {
      await expect(service.getUploadUrl('doc-123', '')).rejects.toThrow(
        'Content-Type must be a non-empty string',
      );
      expect(mockPresign).not.toHaveBeenCalled();
    });
  });

  describe('getObject', () => {
    it('retrieves and returns object bytes', async () => {
      const expectedBytes = new Uint8Array([1, 2, 3, 4]);
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToByteArray: () => Promise.resolve(expectedBytes),
        } as unknown as GetObjectCommandOutput['Body'],
      });

      const result = await service.getObject('uploads/doc-123/original');

      expect(result).toEqual(expectedBytes);
      expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(1);
      const getCall = s3Mock.commandCalls(GetObjectCommand)[0];
      expect(getCall.args[0].input).toEqual({
        Bucket: bucketName,
        Key: 'uploads/doc-123/original',
      });
    });

    it('throws when S3 object response has no body', async () => {
      s3Mock.on(GetObjectCommand).resolves({});

      await expect(
        service.getObject('uploads/doc-123/original'),
      ).rejects.toThrow('S3 object response did not contain a body');
    });

    it('propagates S3 NoSuchKey error without translation', async () => {
      const notFoundError = new Error('The specified key does not exist.');
      notFoundError.name = 'NoSuchKey';
      s3Mock.on(GetObjectCommand).rejects(notFoundError);

      await expect(
        service.getObject('uploads/missing/original'),
      ).rejects.toThrow(notFoundError);
    });
  });

  describe('putObject', () => {
    it('writes the object to the supplied key', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      await service.putObject(
        'processed/doc-123/result',
        'processed-content',
        'text/plain',
      );

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
      const putCall = s3Mock.commandCalls(PutObjectCommand)[0];
      expect(putCall.args[0].input).toEqual({
        Bucket: bucketName,
        Key: 'processed/doc-123/result',
        Body: 'processed-content',
        ContentType: 'text/plain',
      });
    });

    it('propagates unexpected S3 errors unchanged', async () => {
      const s3Error = new Error('S3 Access Denied');
      s3Error.name = 'AccessDenied';
      s3Mock.on(PutObjectCommand).rejects(s3Error);

      await expect(
        service.putObject('processed/doc-123/result', 'content', 'text/plain'),
      ).rejects.toThrow(s3Error);
    });
  });
});
