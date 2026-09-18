import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../../src/handlers/api.handler.js';
import { DocumentService } from '../../src/services/document.service.js';
import type { Document } from '../../src/types/document.js';

type ApiLambdaHandler = (
  event: APIGatewayProxyEventV2,
  context?: Context,
) => Promise<APIGatewayProxyResultV2>;

const invokeHandler = handler as unknown as ApiLambdaHandler;

describe('API Lambda Handler Adapter', () => {
  const dummyContext: Context = {
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'apiHandler',
    functionVersion: '$LATEST',
    invokedFunctionArn:
      'arn:aws:lambda:us-east-1:123456789012:function:apiHandler',
    memoryLimitInMB: '128',
    awsRequestId: 'req-123',
    logGroupName: '/aws/lambda/apiHandler',
    logStreamName: '2026/09/18/[$LATEST]abc',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  const sampleDocument: Document = {
    id: 'doc-123',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 2048,
    status: 'UPLOADED',
    s3Key: 'uploads/doc-123/original',
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
  };

  function createV2Event(options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
    isBase64Encoded?: boolean;
    pathParameters?: Record<string, string>;
  }): APIGatewayProxyEventV2 {
    const method = options.method.toUpperCase();
    const path = options.path;

    return {
      version: '2.0',
      routeKey: `${method} ${path}`,
      rawPath: path,
      rawQueryString: '',
      headers: {
        host: 'api.example.com',
        ...options.headers,
      },
      requestContext: {
        accountId: '123456789012',
        apiId: 'api-id',
        domainName: 'api.example.com',
        domainPrefix: 'api',
        http: {
          method,
          path,
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
        requestId: 'req-id-1',
        routeKey: `${method} ${path}`,
        stage: '$default',
        time: '18/Sep/2026:10:00:00 +0000',
        timeEpoch: 1789725600000,
      },
      body: options.body,
      isBase64Encoded: options.isBase64Encoded ?? false,
      pathParameters: options.pathParameters,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /', () => {
    it('returns status 200 with service name', async () => {
      const event = createV2Event({
        method: 'GET',
        path: '/',
      });

      const response = (await invokeHandler(
        event,
        dummyContext,
      )) as APIGatewayProxyStructuredResultV2;

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('Serverless Document Processing Pipeline');
    });
  });

  describe('POST /documents', () => {
    it('returns status 201 with minimal upload payload for valid request', async () => {
      vi.spyOn(DocumentService.prototype, 'createDocument').mockResolvedValue({
        id: 'doc-123',
        s3Key: 'uploads/doc-123/original',
        uploadUrl:
          'https://s3.amazonaws.com/bucket/uploads/doc-123/original?presigned',
      });

      const event = createV2Event({
        method: 'POST',
        path: '/documents',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 2048,
        }),
      });

      const response = (await invokeHandler(
        event,
        dummyContext,
      )) as APIGatewayProxyStructuredResultV2;

      expect(response.statusCode).toBe(201);
      const parsedBody = JSON.parse(response.body ?? '{}') as Record<
        string,
        unknown
      >;
      expect(parsedBody).toEqual({
        id: 'doc-123',
        s3Key: 'uploads/doc-123/original',
        uploadUrl:
          'https://s3.amazonaws.com/bucket/uploads/doc-123/original?presigned',
      });
      expect(parsedBody.status).toBeUndefined();
      expect(parsedBody.createdAt).toBeUndefined();
      expect(parsedBody.updatedAt).toBeUndefined();
    });

    it('returns status 400 for invalid payload when filename is missing', async () => {
      const event = createV2Event({
        method: 'POST',
        path: '/documents',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: '',
          contentType: 'application/pdf',
          size: 2048,
        }),
      });

      const response = (await invokeHandler(
        event,
        dummyContext,
      )) as APIGatewayProxyStructuredResultV2;

      expect(response.statusCode).toBe(400);
      const parsedBody = JSON.parse(response.body ?? '{}') as {
        error: string;
      };
      expect(parsedBody.error).toContain('filename');
    });

    it('decodes and handles Base64-encoded request payload', async () => {
      vi.spyOn(DocumentService.prototype, 'createDocument').mockResolvedValue({
        id: 'doc-123',
        s3Key: 'uploads/doc-123/original',
        uploadUrl:
          'https://s3.amazonaws.com/bucket/uploads/doc-123/original?presigned',
      });

      const rawJson = JSON.stringify({
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
      });

      const event = createV2Event({
        method: 'POST',
        path: '/documents',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(rawJson).toString('base64'),
        isBase64Encoded: true,
      });

      const response = (await invokeHandler(
        event,
        dummyContext,
      )) as APIGatewayProxyStructuredResultV2;

      expect(response.statusCode).toBe(201);
      const parsedBody = JSON.parse(response.body ?? '{}') as Record<
        string,
        unknown
      >;
      expect(parsedBody.id).toBe('doc-123');
    });
  });

  describe('GET /documents/:id', () => {
    it('returns status 200 when document exists', async () => {
      vi.spyOn(DocumentService.prototype, 'getDocument').mockResolvedValue(
        sampleDocument,
      );

      const event = createV2Event({
        method: 'GET',
        path: '/documents/doc-123',
        pathParameters: { id: 'doc-123' },
      });

      const response = (await invokeHandler(
        event,
        dummyContext,
      )) as APIGatewayProxyStructuredResultV2;

      expect(response.statusCode).toBe(200);
      const parsedBody = JSON.parse(response.body ?? '{}') as Document;
      expect(parsedBody).toEqual(sampleDocument);
    });

    it('returns status 404 when document does not exist', async () => {
      vi.spyOn(DocumentService.prototype, 'getDocument').mockResolvedValue(
        null,
      );

      const event = createV2Event({
        method: 'GET',
        path: '/documents/doc-404',
        pathParameters: { id: 'doc-404' },
      });

      const response = (await invokeHandler(
        event,
        dummyContext,
      )) as APIGatewayProxyStructuredResultV2;

      expect(response.statusCode).toBe(404);
      const parsedBody = JSON.parse(response.body ?? '{}') as {
        error: string;
      };
      expect(parsedBody).toEqual({ error: 'Document not found' });
    });
  });

  describe('Internal error handling', () => {
    it('returns status 500 without leaking stack trace when service throws unexpected error', async () => {
      vi.spyOn(DocumentService.prototype, 'getDocument').mockRejectedValue(
        new Error('Unexpected internal database failure at secret line 42'),
      );

      const event = createV2Event({
        method: 'GET',
        path: '/documents/doc-123',
        pathParameters: { id: 'doc-123' },
      });

      const response = (await invokeHandler(
        event,
        dummyContext,
      )) as APIGatewayProxyStructuredResultV2;

      expect(response.statusCode).toBe(500);
      const parsedBody = JSON.parse(response.body ?? '{}') as Record<
        string,
        unknown
      >;
      expect(parsedBody).toEqual({ error: 'Internal Server Error' });
      expect(response.body).not.toContain('database failure');
      expect(response.body).not.toContain('secret line 42');
      expect(response.body).not.toContain('stack');
    });
  });
});
