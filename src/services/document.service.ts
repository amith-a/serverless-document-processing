import { randomUUID } from 'node:crypto';
import type { DocumentRepository } from '../repositories/document.repository.js';
import { createDocument } from '../types/document.js';
import type { Document } from '../types/document.js';
import type { S3StorageService } from './s3.service.js';

export interface CreateDocumentInput {
  filename: string;
  contentType: string;
  size: number;
}

export interface CreateDocumentOutput {
  id: string;
  s3Key: string;
  uploadUrl: string;
}

export class DocumentService {
  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly s3Service: S3StorageService,
    private readonly idGenerator: () => string = randomUUID,
  ) {}

  async createDocument(
    input: CreateDocumentInput,
  ): Promise<CreateDocumentOutput> {
    const id = this.idGenerator();

    const { uploadUrl, s3Key } = await this.s3Service.getUploadUrl(
      id,
      input.contentType,
    );

    const doc = createDocument({
      id,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      s3Key,
    });

    await this.documentRepository.create(doc);

    return {
      id,
      s3Key,
      uploadUrl,
    };
  }

  async getDocument(id: string): Promise<Document | null> {
    return this.documentRepository.getById(id);
  }
}
