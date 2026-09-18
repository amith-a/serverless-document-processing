import type { DocumentStatus } from './document-status.js';

export type { DocumentStatus };

export interface Document {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  status: DocumentStatus;
  s3Key: string;
  processedS3Key?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentParams {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  s3Key: string;
}

export function createDocument(params: CreateDocumentParams): Document {
  const now = new Date().toISOString();
  return {
    id: params.id,
    filename: params.filename,
    contentType: params.contentType,
    size: params.size,
    status: 'UPLOADED',
    s3Key: params.s3Key,
    createdAt: now,
    updatedAt: now,
  };
}
