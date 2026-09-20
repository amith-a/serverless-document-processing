import { Hono } from 'hono';
import { createDynamoDbClient } from '../clients/dynamodb.client.js';
import { createS3Client } from '../clients/s3.client.js';
import { DocumentRepository } from '../repositories/document.repository.js';
import { DocumentService } from '../services/document.service.js';
import { S3StorageService } from '../services/s3.service.js';
import { createDocumentsRoute } from './routes/documents.js';

export function createApp(documentService?: DocumentService): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    return c.text('Serverless Document Processing Pipeline');
  });

  let service = documentService;
  if (!service) {
    const tableName = process.env.TABLE_NAME ?? '';
    const bucketName = process.env.BUCKET_NAME ?? '';
    const docClient = createDynamoDbClient();
    const s3Client = createS3Client();
    const repository = new DocumentRepository(docClient, tableName);
    const s3Service = new S3StorageService(s3Client, bucketName);
    service = new DocumentService(repository, s3Service);
  }

  app.route('/documents', createDocumentsRoute(service));

  app.onError((err, c) => {
    console.error(
      `[API] Unhandled error during ${c.req.method} ${c.req.path}:`,
      err instanceof Error ? err.message : String(err),
    );
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  return app;
}

const app = createApp();
export default app;
