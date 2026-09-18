import { Hono } from 'hono';
import type { DocumentService } from '../../services/document.service.js';
import {
  validateCreateDocumentRequest,
  validateDocumentId,
} from '../validators/document.validator.js';

export function createDocumentsRoute(documentService: DocumentService): Hono {
  const router = new Hono();

  router.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    const validation = validateCreateDocumentRequest(body);
    if (!validation.success) {
      return c.json({ error: validation.error }, 400);
    }

    const result = await documentService.createDocument(validation.data);
    return c.json(result, 201);
  });

  router.get('/:id', async (c) => {
    const rawId = c.req.param('id');
    const validation = validateDocumentId(rawId);
    if (!validation.success) {
      return c.json({ error: validation.error }, 400);
    }

    const document = await documentService.getDocument(validation.data);
    if (!document) {
      return c.json({ error: 'Document not found' }, 404);
    }

    return c.json(document, 200);
  });

  return router;
}
