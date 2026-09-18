import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConditionalCheckFailedError,
  DocumentAlreadyExistsError,
  DocumentRepository,
} from '../../src/repositories/document.repository.js';
import { InvalidStateTransitionError } from '../../src/types/document-status.js';
import type { Document } from '../../src/types/document.js';

describe('DocumentRepository', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const tableName = 'test-documents-table';
  let repository: DocumentRepository;

  const sampleDocument: Document = {
    id: 'doc-123',
    filename: 'test.pdf',
    contentType: 'application/pdf',
    size: 2048,
    status: 'UPLOADED',
    s3Key: 'uploads/doc-123/original',
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
  };

  beforeEach(() => {
    ddbMock.reset();
    repository = new DocumentRepository(
      ddbMock as unknown as DynamoDBDocumentClient,
      tableName,
    );
  });

  describe('create', () => {
    it('creates and returns the document when it does not exist', async () => {
      ddbMock.on(PutCommand).resolves({});

      const created = await repository.create(sampleDocument);

      expect(created).toEqual(sampleDocument);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input).toEqual({
        TableName: tableName,
        Item: sampleDocument,
        ConditionExpression: 'attribute_not_exists(id)',
      });
    });

    it('throws DocumentAlreadyExistsError when document already exists', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      await expect(repository.create(sampleDocument)).rejects.toThrow(
        DocumentAlreadyExistsError,
      );
    });
  });

  describe('getById', () => {
    it('returns the document when it exists', async () => {
      ddbMock.on(GetCommand).resolves({ Item: sampleDocument });

      const result = await repository.getById('doc-123');

      expect(result).toEqual(sampleDocument);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
      const getCall = ddbMock.commandCalls(GetCommand)[0];
      expect(getCall.args[0].input).toEqual({
        TableName: tableName,
        Key: { id: 'doc-123' },
      });
    });

    it('returns null when document does not exist', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await repository.getById('doc-404');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('updates status and returns updated document on valid transition', async () => {
      const updatedDoc: Document = {
        ...sampleDocument,
        status: 'PROCESSING',
        updatedAt: '2026-09-18T10:05:00.000Z',
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedDoc });

      const result = await repository.updateStatus(
        'doc-123',
        'UPLOADED',
        'PROCESSING',
      );

      expect(result).toEqual(updatedDoc);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input.TableName).toBe(tableName);
      expect(updateCall.args[0].input.Key).toEqual({ id: 'doc-123' });
      expect(updateCall.args[0].input.ConditionExpression).toBe(
        'attribute_exists(id) AND #status = :expectedStatus',
      );
    });

    it('rejects invalid domain transition without calling DynamoDB', async () => {
      await expect(
        repository.updateStatus('doc-123', 'UPLOADED', 'COMPLETED'),
      ).rejects.toThrow(InvalidStateTransitionError);

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('throws ConditionalCheckFailedError when DynamoDB condition fails', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      await expect(
        repository.updateStatus('doc-123', 'UPLOADED', 'PROCESSING'),
      ).rejects.toThrow(ConditionalCheckFailedError);
    });
  });

  describe('updateProcessingResult', () => {
    const processedKey = 'processed/doc-123/result';

    it('persists processedS3Key, updates status and updatedAt, and returns document', async () => {
      const completedDoc: Document = {
        ...sampleDocument,
        status: 'COMPLETED',
        processedS3Key: processedKey,
        updatedAt: '2026-09-18T10:10:00.000Z',
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: completedDoc });

      const result = await repository.updateProcessingResult(
        'doc-123',
        'PROCESSING',
        'COMPLETED',
        processedKey,
      );

      expect(result).toEqual(completedDoc);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input.TableName).toBe(tableName);
      expect(updateCall.args[0].input.Key).toEqual({ id: 'doc-123' });
      expect(updateCall.args[0].input.ConditionExpression).toBe(
        'attribute_exists(id) AND #status = :expectedStatus',
      );
      expect(updateCall.args[0].input.UpdateExpression).toBe(
        'SET #status = :nextStatus, #updatedAt = :updatedAt, #processedS3Key = :processedS3Key',
      );
      expect(
        updateCall.args[0].input.ExpressionAttributeValues?.[':processedS3Key'],
      ).toBe(processedKey);
      expect(
        updateCall.args[0].input.ExpressionAttributeValues?.[':nextStatus'],
      ).toBe('COMPLETED');
      expect(
        updateCall.args[0].input.ExpressionAttributeValues?.[':expectedStatus'],
      ).toBe('PROCESSING');
    });

    it('rejects invalid state transition before calling DynamoDB', async () => {
      await expect(
        repository.updateProcessingResult(
          'doc-123',
          'UPLOADED',
          'COMPLETED',
          processedKey,
        ),
      ).rejects.toThrow(InvalidStateTransitionError);

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('throws ConditionalCheckFailedError when DynamoDB condition check fails', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      await expect(
        repository.updateProcessingResult(
          'doc-123',
          'PROCESSING',
          'COMPLETED',
          processedKey,
        ),
      ).rejects.toThrow(ConditionalCheckFailedError);
    });

    it('propagates unexpected DynamoDB errors unchanged', async () => {
      const unexpectedError = new Error('DynamoDB connection timeout');
      unexpectedError.name = 'TimeoutError';
      ddbMock.on(UpdateCommand).rejects(unexpectedError);

      await expect(
        repository.updateProcessingResult(
          'doc-123',
          'PROCESSING',
          'COMPLETED',
          processedKey,
        ),
      ).rejects.toThrow(unexpectedError);
    });
  });
});
