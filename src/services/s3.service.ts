import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getUploadKey } from '../storage/s3-keys.js';

export interface PresignedUploadResult {
  uploadUrl: string;
  s3Key: string;
}

export type PresignerFn = (
  client: S3Client,
  command: PutObjectCommand,
  options?: { expiresIn?: number },
) => Promise<string>;

export class S3StorageService {
  constructor(
    private readonly s3Client: S3Client,
    private readonly bucketName: string,
    private readonly presignFn: PresignerFn = getSignedUrl,
  ) {}

  async getUploadUrl(
    documentId: string,
    contentType: string,
    expiresInSeconds: number = 900,
  ): Promise<PresignedUploadResult> {
    if (
      !contentType ||
      typeof contentType !== 'string' ||
      contentType.trim() === ''
    ) {
      throw new Error('Content-Type must be a non-empty string');
    }

    const s3Key = getUploadKey(documentId);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      ContentType: contentType,
    });

    const uploadUrl = await this.presignFn(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      uploadUrl,
      s3Key,
    };
  }

  async getObject(key: string): Promise<Uint8Array> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error('S3 object response did not contain a body');
    }

    return response.Body.transformToByteArray();
  }

  async putObject(
    key: string,
    body: Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.s3Client.send(command);
  }
}
