import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerHandler } from '../../src/handlers/worker.handler.js';
import type { DocumentRepository } from '../../src/repositories/document.repository.js';
import { ConditionalCheckFailedError } from '../../src/repositories/document.repository.js';
import type { ProcessingResult } from '../../src/services/document-processor.js';
import type { S3StorageService } from '../../src/services/s3.service.js';

describe('Worker Lambda Handler - Unit Tests', () => {
  let mockRepository: {
    updateStatus: ReturnType<typeof vi.fn>;
    updateProcessingResult: ReturnType<typeof vi.fn>;
  };
  let mockS3Service: {
    getObject: ReturnType<typeof vi.fn>;
    putObject: ReturnType<typeof vi.fn>;
  };
  let handler: ReturnType<typeof createWorkerHandler>;

  const defaultAttributes: SQSRecord['attributes'] = {
    ApproximateReceiveCount: '1',
    SentTimestamp: '1545082649183',
    SenderId: 'AIDAIENQZJOLO23YVJ4VO',
    ApproximateFirstReceiveTimestamp: '1545082649185',
  };

  function createSqsEvent(
    records: { bucket: string; key: string }[],
  ): SQSEvent {
    return {
      Records: records.map((r, idx) => ({
        messageId: `msg-${idx}`,
        receiptHandle: `receipt-${idx}`,
        body: JSON.stringify({
          Records: [
            {
              eventVersion: '2.1',
              eventSource: 'aws:s3',
              awsRegion: 'us-east-1',
              eventTime: '2026-09-19T10:00:00.000Z',
              eventName: 'ObjectCreated:Put',
              s3: {
                s3SchemaVersion: '1.0',
                configurationId: 'config-1',
                bucket: {
                  name: r.bucket,
                  arn: `arn:aws:s3:::${r.bucket}`,
                },
                object: {
                  key: r.key,
                  size: 1024,
                },
              },
            },
          ],
        }),
        attributes: defaultAttributes,
        messageAttributes: {},
        md5OfBody: 'test-md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
        awsRegion: 'us-east-1',
      })),
    };
  }

  beforeEach(() => {
    mockRepository = {
      updateStatus: vi.fn().mockResolvedValue({}),
      updateProcessingResult: vi.fn().mockResolvedValue({}),
    };
    mockS3Service = {
      getObject: vi
        .fn()
        .mockResolvedValue(
          new TextEncoder().encode('Hello world\nSecond line'),
        ),
      putObject: vi.fn().mockResolvedValue(undefined),
    };

    handler = createWorkerHandler({
      repository: mockRepository as unknown as DocumentRepository,
      s3Service: mockS3Service as unknown as S3StorageService,
    });
  });

  it('successfully processes valid S3 ObjectCreated event in SQS message', async () => {
    const event = createSqsEvent([
      { bucket: 'my-bucket', key: 'uploads/doc-test-123/original' },
    ]);

    await handler(event);

    // 1. Claim document
    expect(mockRepository.updateStatus).toHaveBeenCalledTimes(1);
    expect(mockRepository.updateStatus).toHaveBeenCalledWith(
      'doc-test-123',
      'UPLOADED',
      'PROCESSING',
    );

    // 2. Read object from S3
    expect(mockS3Service.getObject).toHaveBeenCalledTimes(1);
    expect(mockS3Service.getObject).toHaveBeenCalledWith(
      'uploads/doc-test-123/original',
    );

    // 3. Write result to S3
    expect(mockS3Service.putObject).toHaveBeenCalledTimes(1);
    const putCall = mockS3Service.putObject.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(putCall[0]).toBe('processed/doc-test-123/result');
    const parsedResult = JSON.parse(putCall[1]) as ProcessingResult;
    expect(parsedResult.documentId).toBe('doc-test-123');
    expect(parsedResult.lineCount).toBe(2);
    expect(parsedResult.wordCount).toBe(4);
    expect(parsedResult.characterCount).toBe('Hello world\nSecond line'.length);
    expect(putCall[2]).toBe('application/json');

    // 4. Update DynamoDB to COMPLETED
    expect(mockRepository.updateProcessingResult).toHaveBeenCalledTimes(1);
    expect(mockRepository.updateProcessingResult).toHaveBeenCalledWith(
      'doc-test-123',
      'PROCESSING',
      'COMPLETED',
      'processed/doc-test-123/result',
    );
  });

  it('handles URL-encoded S3 keys correctly', async () => {
    const event = createSqsEvent([
      { bucket: 'my-bucket', key: 'uploads%2Fdoc-encoded-456%2Foriginal' },
    ]);

    await handler(event);

    expect(mockRepository.updateStatus).toHaveBeenCalledWith(
      'doc-encoded-456',
      'UPLOADED',
      'PROCESSING',
    );
    expect(mockS3Service.getObject).toHaveBeenCalledWith(
      'uploads/doc-encoded-456/original',
    );
  });

  it('handles duplicate delivery gracefully when document is already claimed (idempotency)', async () => {
    mockRepository.updateStatus.mockRejectedValue(
      new ConditionalCheckFailedError('Document already claimed'),
    );

    const event = createSqsEvent([
      { bucket: 'my-bucket', key: 'uploads/doc-duplicate/original' },
    ]);

    // Should resolve without throwing
    await expect(handler(event)).resolves.toBeUndefined();

    expect(mockRepository.updateStatus).toHaveBeenCalledTimes(1);
    expect(mockS3Service.getObject).not.toHaveBeenCalled();
    expect(mockS3Service.putObject).not.toHaveBeenCalled();
    expect(mockRepository.updateProcessingResult).not.toHaveBeenCalled();
  });

  it('re-throws error when S3 getObject fails and does not transition document to FAILED before SQS retries', async () => {
    mockS3Service.getObject.mockRejectedValue(new Error('S3 object not found'));

    const event = createSqsEvent([
      { bucket: 'my-bucket', key: 'uploads/doc-err/original' },
    ]);

    await expect(handler(event)).rejects.toThrow('S3 object not found');

    expect(mockRepository.updateStatus).toHaveBeenCalledTimes(1);
    expect(mockRepository.updateStatus).toHaveBeenCalledWith(
      'doc-err',
      'UPLOADED',
      'PROCESSING',
    );
    // Crucial: Must NOT call updateStatus with FAILED
    expect(mockRepository.updateStatus).not.toHaveBeenCalledWith(
      'doc-err',
      'PROCESSING',
      'FAILED',
    );
    expect(mockRepository.updateProcessingResult).not.toHaveBeenCalled();
  });

  it('re-throws error when S3 putObject fails and does not mark completed', async () => {
    mockS3Service.putObject.mockRejectedValue(new Error('S3 put failed'));

    const event = createSqsEvent([
      { bucket: 'my-bucket', key: 'uploads/doc-put-err/original' },
    ]);

    await expect(handler(event)).rejects.toThrow('S3 put failed');

    expect(mockRepository.updateProcessingResult).not.toHaveBeenCalled();
  });

  it('re-throws error when DynamoDB updateProcessingResult fails', async () => {
    mockRepository.updateProcessingResult.mockRejectedValue(
      new Error('DynamoDB write error'),
    );

    const event = createSqsEvent([
      { bucket: 'my-bucket', key: 'uploads/doc-ddb-err/original' },
    ]);

    await expect(handler(event)).rejects.toThrow('DynamoDB write error');
  });

  it('throws error when SQS record body is invalid JSON', async () => {
    const event: SQSEvent = {
      Records: [
        {
          messageId: 'bad-json-msg',
          receiptHandle: 'receipt',
          body: 'not-valid-json',
          attributes: defaultAttributes,
          messageAttributes: {},
          md5OfBody: 'md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
          awsRegion: 'us-east-1',
        },
      ],
    };

    await expect(handler(event)).rejects.toThrow(
      'Invalid JSON in SQS record body',
    );
  });

  it('throws error when SQS record body has no S3 Records', async () => {
    const event: SQSEvent = {
      Records: [
        {
          messageId: 'no-records-msg',
          receiptHandle: 'receipt',
          body: JSON.stringify({ Records: [] }),
          attributes: defaultAttributes,
          messageAttributes: {},
          md5OfBody: 'md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
          awsRegion: 'us-east-1',
        },
      ],
    };

    await expect(handler(event)).rejects.toThrow(
      'SQS message does not contain valid S3 event records',
    );
  });

  it('throws error when S3 key does not match upload pattern', async () => {
    const event = createSqsEvent([
      { bucket: 'my-bucket', key: 'processed/doc-123/result' },
    ]);

    await expect(handler(event)).rejects.toThrow(
      'S3 key does not match expected upload pattern: processed/doc-123/result',
    );
  });
});
