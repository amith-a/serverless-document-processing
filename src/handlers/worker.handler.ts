import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { createDynamoDbClient } from '../clients/dynamodb.client.js';
import { createS3Client } from '../clients/s3.client.js';
import {
  ConditionalCheckFailedError,
  DocumentRepository,
} from '../repositories/document.repository.js';
import { processDocumentContent } from '../services/document-processor.js';
import { S3StorageService } from '../services/s3.service.js';
import {
  getProcessedKey,
  parseDocumentIdFromUploadKey,
} from '../storage/s3-keys.js';

interface S3NotificationRecord {
  s3: {
    bucket: {
      name: string;
    };
    object: {
      key: string;
    };
  };
}

export interface WorkerDependencies {
  repository?: DocumentRepository;
  s3Service?: S3StorageService;
  processor?: typeof processDocumentContent;
}

export function createWorkerHandler(deps?: WorkerDependencies) {
  let repository = deps?.repository;
  let s3Service = deps?.s3Service;
  const processor = deps?.processor ?? processDocumentContent;

  function getRepository(): DocumentRepository {
    if (!repository) {
      const tableName = process.env.TABLE_NAME ?? '';
      const docClient = createDynamoDbClient();
      repository = new DocumentRepository(docClient, tableName);
    }
    return repository;
  }

  function getS3Service(): S3StorageService {
    if (!s3Service) {
      const bucketName = process.env.BUCKET_NAME ?? '';
      const s3Client = createS3Client();
      s3Service = new S3StorageService(s3Client, bucketName);
    }
    return s3Service;
  }

  return async function handler(event: SQSEvent): Promise<void> {
    const repo = getRepository();
    const s3 = getS3Service();

    for (const record of event.Records) {
      await processSqsRecord(record, repo, s3, processor);
    }
  };
}

async function processSqsRecord(
  record: SQSRecord,
  repository: DocumentRepository,
  s3Service: S3StorageService,
  processor: typeof processDocumentContent,
): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(record.body);
  } catch (error) {
    throw new Error(
      `Invalid JSON in SQS record body: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const s3Records = extractS3Records(body);
  if (!s3Records || s3Records.length === 0) {
    throw new Error('SQS message does not contain valid S3 event records');
  }

  for (const s3Record of s3Records) {
    const rawKey = s3Record.s3.object.key;
    const s3Key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const documentId = parseDocumentIdFromUploadKey(s3Key);

    if (!documentId) {
      throw new Error(
        `S3 key does not match expected upload pattern: ${s3Key}`,
      );
    }

    try {
      await repository.updateStatus(documentId, 'UPLOADED', 'PROCESSING');
    } catch (error) {
      if (error instanceof ConditionalCheckFailedError) {
        console.warn(
          `[Worker] Document ${documentId} could not be transitioned from UPLOADED to PROCESSING (condition check failed). Skipping duplicate delivery.`,
        );
        return;
      }
      throw error;
    }

    try {
      const content = await s3Service.getObject(s3Key);
      const processingResult = processor(documentId, content);
      const processedKey = getProcessedKey(documentId);

      await s3Service.putObject(
        processedKey,
        JSON.stringify(processingResult),
        'application/json',
      );

      await repository.updateProcessingResult(
        documentId,
        'PROCESSING',
        'COMPLETED',
        processedKey,
      );
    } catch (error) {
      console.error(
        `[Worker] Failed processing document ${documentId}:`,
        error,
      );
      // Re-throw so SQS triggers native retry/DLQ redrive
      throw error;
    }
  }
}

function extractS3Records(body: unknown): S3NotificationRecord[] | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const payload = body as Record<string, unknown>;
  if (!Array.isArray(payload.Records) || payload.Records.length === 0) {
    return null;
  }

  const results: S3NotificationRecord[] = [];
  for (const item of payload.Records) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const rec = item as {
      s3?: {
        bucket?: { name?: unknown };
        object?: { key?: unknown };
      };
    };
    const bucketName = rec.s3?.bucket?.name;
    const objectKey = rec.s3?.object?.key;
    if (typeof bucketName !== 'string' || typeof objectKey !== 'string') {
      return null;
    }
    results.push({
      s3: {
        bucket: { name: bucketName },
        object: { key: objectKey },
      },
    });
  }

  return results;
}

export const handler = createWorkerHandler();
