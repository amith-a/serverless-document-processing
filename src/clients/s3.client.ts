import { S3Client } from '@aws-sdk/client-s3';

export function createS3Client(client?: S3Client): S3Client {
  return client ?? new S3Client({});
}
