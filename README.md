# Serverless Document Processing Pipeline

A backend-focused serverless document processing pipeline built with **Node.js**, **TypeScript**, **Hono**, and **AWS services**.

The objective of this project is to demonstrate clear, disciplined engineering decisions: event-driven architecture, asynchronous processing, idempotency, retry and DLQ handling, least-privilege IAM, and Infrastructure as Code without unnecessary frameworks or abstractions.

---

## 1. Architecture

```text
                         Client / CLI
                              |
                              v
                      +---------------+
                      |  API Gateway  |
                      |   HTTP API    |
                      +-------+-------+
                              |
                              v
                      +---------------+
                      |  API Lambda   |
                      |    (Hono)     |
                      +-------+-------+
                              |
                       +------+------+
                       |             |
                       v             v
                      S3         DynamoDB
                       |
                ObjectCreated
                       |
                       v
                      SQS  ──> DLQ
                       |
                       v
                +--------------+
                | Worker Lambda|
                +------+-------+
                       |
                  +----+----+
                  |         |
                  v         v
                 S3      DynamoDB
```

The API Lambda and Worker Lambda have strict separation of concerns:

- The API Lambda handles synchronous HTTP requests and issues presigned upload instructions.
- The Worker Lambda handles asynchronous document processing directly from SQS.
- The Worker Lambda never communicates directly with the API Lambda.

---

## 2. Hono's Role

[Hono](https://hono.dev/) is used strictly as the HTTP application layer inside the API Lambda:

- **Responsibilities**:
  - Request routing (`POST /documents`, `GET /documents/:id`)
  - Request validation integration
  - HTTP error handling and status code mapping
  - Response payload construction
- **Explicit Boundary**:
  - Hono is **not** used in the Worker Lambda.
  - Hono does **not** manage AWS infrastructure, SQS events, document processing, or DynamoDB data modeling.
  - Route handlers remain thin, delegating business logic to domain services and repositories.

---

## 3. API Flow

### `POST /documents`

Creates document metadata and returns a presigned URL for direct S3 client upload:

```text
Client Request ──> API Gateway ──> API Lambda (Hono)
                                          │
                                   Validate Input
                                          │
                       ┌──────────────────┴──────────────────┐
                       ▼                                     ▼
             Generate S3 Presigned URL             Save Document to DynamoDB
             (uploads/{id}/original)                   (status: UPLOADED)
                       │                                     │
                       └──────────────────┬──────────────────┘
                                          ▼
                               Minimal HTTP Response:
                       { id, s3Key, uploadUrl }
```

- **Minimal Contract**: Returns strictly `{ id, s3Key, uploadUrl }`. Internal fields (`status`, `createdAt`, `updatedAt`) are not exposed.
- **Atomicity**: If DynamoDB persistence fails, the operation rejects and no upload information is returned.
- **No In-Band Processing**: The API Lambda never processes the document.

### `GET /documents/:id`

Retrieves document metadata and processing status:

- Validates the `id` parameter (trims whitespace, rejects blank IDs).
- Queries DynamoDB by primary key `id`.
- Returns `200 OK` with the complete `Document` domain object, or `404 Not Found` if missing.

---

## 4. S3 Flow

- **Bucket Configuration**: Private bucket, public access completely blocked, server-side AES-256 encryption.
- **Deterministic Keys**:
  - Uploads: `uploads/{document-id}/original`
  - Processed Output: `processed/{document-id}/result`
- **Prefix Isolation**: S3 event notifications trigger only on the `uploads/` prefix. This strictly prevents processed results in `processed/` from causing infinite processing loops.

---

## 5. SQS & Asynchronous Messaging

```text
S3 ObjectCreated (uploads/*) ──> SQS Main Queue ──(redrive)──> SQS DLQ
                                       │
                                EventSourceMapping
                                       │
                                       ▼
                                 Worker Lambda
```

- **Main Queue**: Buffers document upload notifications from S3.
- **Queue Policy**: Restricted strictly so that only the designated S3 bucket ARN can send messages to the queue.
- **Dead Letter Queue (DLQ)**: Captures poison messages or events that fail after the maximum receive count.
- **Decoupling**: Decouples document ingest from processing capacity and absorption of load spikes.

---

## 6. Worker Processing

The Worker Lambda is invoked directly by AWS Lambda Event Source Mapping from SQS:

```text
SQS Event ──> Validate Event ──> Claim Document (Conditional Write)
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   ▼                                             ▼
             Read S3 Object                                Update DynamoDB
                   │                                      (status: FAILED)
             Process Content                                     │
                   │                                       Allow SQS Retry
             Write S3 Output
             (processed/{id}/result)
                   │
             Update DynamoDB
            (status: COMPLETED)
```

- The worker does not use Hono.
- Processing is deterministic and simple (e.g. word count, line count, or text transformation) without external AI/OCR dependencies.

---

## 7. DynamoDB Data Model

Designed strictly around single-table access patterns:

- **Primary Key**: `id` (String, Hash key)
- **Document Attributes**:
  - `id`: Unique document identifier (UUID)
  - `filename`: Original document filename
  - `contentType`: MIME type
  - `size`: Size in bytes
  - `status`: Lifecycle state (`UPLOADED` | `PROCESSING` | `COMPLETED` | `FAILED`)
  - `s3Key`: Deterministic S3 key of the original upload
  - `processedS3Key`: Deterministic S3 key of the processed result (optional)
  - `createdAt`: ISO-8601 timestamp
  - `updatedAt`: ISO-8601 timestamp

---

## 8. Idempotency & State Machine

```text
UPLOADED ──(conditional claim)──> PROCESSING ──┬──> COMPLETED
                                               └──> FAILED
```

- SQS offers at-least-once delivery; messages can be delivered more than once.
- The worker claims a document using a **DynamoDB conditional write**:
  ```text
  attribute_exists(id) AND #status = :expectedStatus
  ```
- If the condition fails, the worker knows another execution already claimed the document, preventing duplicate processing.

---

## 9. Retry Handling & DLQ

- Failed worker executions reject and propagate the error.
- SQS manages retries via native visibility timeouts and redrive policies.
- After reaching `maxReceiveCount`, the message moves to the Dead Letter Queue.
- No custom in-application retry loops or counters are implemented.

---

## 10. Least-Privilege IAM

IAM policies are strictly derived from actual runtime operations:

- **API Lambda Role**:
  - `dynamodb:PutItem`, `dynamodb:GetItem` on `DocumentsTable`
  - `s3:PutObject` on `DocumentsBucket/uploads/*`
  - `logs:CreateLogStream`, `logs:PutLogEvents` on dedicated Log Group
- **Worker Lambda Role**:
  - `dynamodb:GetItem`, `dynamodb:UpdateItem` on `DocumentsTable`
  - `s3:GetObject` on `DocumentsBucket/uploads/*`
  - `s3:PutObject` on `DocumentsBucket/processed/*`
  - `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` on `DocumentProcessingQueue`
  - `logs:CreateLogStream`, `logs:PutLogEvents` on dedicated Log Group
- **SQS Queue Policy**: Restricts `sqs:SendMessage` strictly to the S3 bucket source ARN.

---

## 11. Infrastructure as Code (CloudFormation)

CloudFormation is the infrastructure source of truth:

- **[`infra/bootstrap.yaml`](infra/bootstrap.yaml)**: One-time bootstrap stack creating the deployment artifacts S3 bucket with versioning, 30-day lifecycle expiration, and TLS enforcement.
- **[`infra/template.yaml`](infra/template.yaml)**: Complete application stack:
  - `AWS::DynamoDB::Table`
  - `AWS::S3::Bucket`
  - `AWS::ApiGatewayV2::Api`, `Integration`, `Route`, `Stage`
  - `AWS::Lambda::Function`, `Permission`, `EventSourceMapping`
  - `AWS::SQS::Queue`, `QueuePolicy`
  - `AWS::IAM::Role`
  - `AWS::Logs::LogGroup`

---

## 12. Local Verification with Floci

[Floci](https://github.com/floci-io/floci) is used for manual local AWS behavior verification:

- **Mandatory Separation**: Floci is **not** part of the automated test suite and contains **zero** application or CloudFormation code (`no if local`, `no if floci`).
- **Workflow**:
  ```bash
  # Local packaging & deployment
  $env:AWS_ENDPOINT_URL = "http://localhost:4566"
  aws cloudformation package --template-file infra/template.yaml --output-template-file infra/packaged.yaml --s3-bucket <local-artifacts-bucket>
  aws cloudformation deploy --template-file infra/packaged.yaml --stack-name serverless-doc-pipeline --capabilities CAPABILITY_NAMED_IAM
  ```

---

## 13. Unit Testing Strategy

Unit tests are **100% offline** and do not require Docker, Floci, AWS credentials, or network access:

```bash
# Run unit tests
npm test

# Run code style & static analysis
npm run lint
npm run format:check
npm run typecheck
```

Test coverage includes:

- Domain state transitions & invariants ([`tests/unit/document-status.test.ts`](tests/unit/document-status.test.ts))
- DynamoDB repository conditional writes ([`tests/unit/document.repository.test.ts`](tests/unit/document.repository.test.ts))
- S3 key generation & storage service ([`tests/unit/s3.service.test.ts`](tests/unit/s3.service.test.ts))
- Document service orchestration ([`tests/unit/document.service.test.ts`](tests/unit/document.service.test.ts))
- Hono HTTP routes & validation edge cases ([`tests/unit/api.test.ts`](tests/unit/api.test.ts))
- API Lambda adapter boundary ([`tests/unit/api.handler.test.ts`](tests/unit/api.handler.test.ts))

---

## 14. Project Structure

```text
src/
├── api/
│   ├── app.ts                  # Hono application factory & global error handler
│   ├── routes/
│   │   └── documents.ts        # POST /documents & GET /documents/:id routes
│   └── validators/
│       └── document.validator.ts # Boundary request validation
├── clients/
│   ├── dynamodb.client.ts      # AWS SDK v3 DynamoDB client factory
│   └── s3.client.ts            # AWS SDK v3 S3 client factory
├── handlers/
│   ├── api.handler.ts          # API Gateway Lambda adapter (handle(app))
│   └── worker.handler.ts       # SQS Worker Lambda handler
├── repositories/
│   └── document.repository.ts  # DynamoDB CRUD & conditional status updates
├── services/
│   ├── document.service.ts     # Document lifecycle orchestration
│   └── s3.service.ts           # S3 presigned URLs & object operations
├── storage/
│   └── s3-keys.ts              # Deterministic S3 key formatting
└── types/
    ├── document.ts             # Domain Document model
    └── document-status.ts      # DocumentStatus enum & transition state machine

infra/
├── bootstrap.yaml              # Deployment artifacts S3 bucket
└── template.yaml               # Complete CloudFormation infrastructure

tests/
└── unit/                       # Pure offline Vitest unit tests
```

---

## 15. Known Limitations

- **No In-Band OCR / Heavy Processing**: Document processing is deliberately simple (deterministic metadata/text analysis) to focus on the serverless architecture.
- **Unauthenticated HTTP API**: API Gateway endpoints do not include Cognito/IAM authorizers to keep the focus on pipeline mechanics.
- **Single-Region**: Configured for single-region deployment per stack.
