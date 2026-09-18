import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { transitionStatus } from '../types/document-status.js';
import type { Document, DocumentStatus } from '../types/document.js';

export class DocumentAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Document already exists: ${id}`);
    this.name = 'DocumentAlreadyExistsError';
  }
}

export class ConditionalCheckFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionalCheckFailedError';
  }
}

export class DocumentRepository {
  constructor(
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(doc: Document): Promise<Document> {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: doc,
          ConditionExpression: 'attribute_not_exists(id)',
        }),
      );
      return doc;
    } catch (error) {
      if (this.isConditionalCheckFailed(error)) {
        throw new DocumentAlreadyExistsError(doc.id);
      }
      throw error;
    }
  }

  async getById(id: string): Promise<Document | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id },
      }),
    );

    if (!result.Item) {
      return null;
    }

    return result.Item as Document;
  }

  async updateStatus(
    id: string,
    expectedStatus: DocumentStatus,
    nextStatus: DocumentStatus,
  ): Promise<Document> {
    transitionStatus(expectedStatus, nextStatus);

    const now = new Date().toISOString();

    try {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression:
            'SET #status = :nextStatus, #updatedAt = :updatedAt',
          ConditionExpression:
            'attribute_exists(id) AND #status = :expectedStatus',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':nextStatus': nextStatus,
            ':expectedStatus': expectedStatus,
            ':updatedAt': now,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );

      return result.Attributes as Document;
    } catch (error) {
      if (this.isConditionalCheckFailed(error)) {
        throw new ConditionalCheckFailedError(
          `Failed to transition document ${id} from ${expectedStatus} to ${nextStatus}: condition check failed`,
        );
      }
      throw error;
    }
  }

  async updateProcessingResult(
    id: string,
    expectedStatus: DocumentStatus,
    nextStatus: DocumentStatus,
    processedS3Key: string,
  ): Promise<Document> {
    transitionStatus(expectedStatus, nextStatus);

    const now = new Date().toISOString();

    try {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression:
            'SET #status = :nextStatus, #updatedAt = :updatedAt, #processedS3Key = :processedS3Key',
          ConditionExpression:
            'attribute_exists(id) AND #status = :expectedStatus',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#processedS3Key': 'processedS3Key',
          },
          ExpressionAttributeValues: {
            ':nextStatus': nextStatus,
            ':expectedStatus': expectedStatus,
            ':updatedAt': now,
            ':processedS3Key': processedS3Key,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );

      return result.Attributes as Document;
    } catch (error) {
      if (this.isConditionalCheckFailed(error)) {
        throw new ConditionalCheckFailedError(
          `Failed to transition document ${id} from ${expectedStatus} to ${nextStatus}: condition check failed`,
        );
      }
      throw error;
    }
  }

  private isConditionalCheckFailed(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name: string }).name === 'ConditionalCheckFailedException'
    );
  }
}
