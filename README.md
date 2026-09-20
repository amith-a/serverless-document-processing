# Serverless Document Processing Pipeline

A backend serverless pipeline built with **Node.js**, **TypeScript**, **Hono**, and **AWS services** (API Gateway, Lambda, S3, SQS, DynamoDB, CloudFormation, CloudWatch).

Demonstrates asynchronous event-driven processing, idempotency via conditional writes, native retry/DLQ handling, least-privilege IAM, and Infrastructure as Code without unnecessary abstractions.

---

## 1. Architecture

```text
 Client / Node CLI
        |
        v
+---------------+
|  API Gateway  | (HTTP API)
+-------+-------+
        |
        v
+---------------+
|  API Lambda   | (Hono HTTP application)
+-------+-------+
        |
 +------+------+
 |             |
 v             v
S3         DynamoDB (Metadata & state: UPLOADED)
 |
ObjectCreated (uploads/*)
 |
 v
SQS  ──(3 retries)──> SQS DLQ
 |
 v
+---------------+
| Worker Lambda | (Text metrics & JSON output)
+-------+-------+
        |
 +------+------+
 |             |
 v             v
S3         DynamoDB (State: COMPLETED)
(processed/*)
```

The API Lambda and Worker Lambda are strictly decoupled:

- **API Lambda**: Synchronous HTTP entrypoint issuing presigned S3 upload URLs.
- **Worker Lambda**: Asynchronous processing engine reading from S3 and writing results.
- **Independence**: The Worker never communicates directly with the API Lambda.

---

## 2. Core Architectural Decisions

- **Why Hono?** Ultra-lightweight, type-safe HTTP router with near-zero cold-start overhead (~1.7 MB bundled Lambda package).
- **Why no Hono in Worker?** SQS events are native AWS event payloads, not HTTP requests. Wrapping an SQS event in an HTTP framework is an unnecessary abstraction.
- **Why asynchronous processing?** Prevents API Gateway 30s timeouts, preserves low API latency, and absorbs traffic spikes independently of API capacity.
- **Why SQS?** Buffers notifications, levels concurrency spikes, and provides native visibility timeouts with Dead Letter Queue isolation.
- **Why DynamoDB?** Serverless single-digit millisecond key-value store with atomic **conditional writes** and no connection-pooling bottlenecks.
- **Why conditional writes?** Solves at-least-once SQS duplicate message delivery. Exactly one worker claims the document; concurrent duplicates are safely skipped without external distributed locks.
- **Why Floci is local only?** Keeps application code and CloudFormation 100% AWS-native (`no if local`, `no if floci`), eliminating cloud-emulator drift.
- **Why unit tests don't require AWS?** 100% offline mocks (`aws-sdk-client-mock`) execute in <2 seconds without network, credentials, or Docker.
- **Why no OCR / AI?** Deliberate scope discipline. Focuses on backend distributed systems patterns rather than external API dependencies.

---

## 3. API Specification

### `POST /documents`

Registers document metadata and returns an S3 presigned PUT URL.

- **Request**:
  ```json
  { "filename": "report.txt", "contentType": "text/plain", "size": 1024 }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "id": "uuid",
    "s3Key": "uploads/uuid/original",
    "uploadUrl": "https://bucket.s3.amazonaws.com/uploads/uuid/original?..."
  }
  ```
- **Errors**: `400 Bad Request` (invalid body/params), `409 Conflict` (duplicate ID), `500 Internal Server Error` (masked safely).

### `GET /documents/:id`

Retrieves document metadata and processing status.

- **Response (`200 OK`)**: Returns full document object (`id`, `filename`, `status`, `s3Key`, `processedS3Key`, `createdAt`, `updatedAt`).
- **Response (`404 Not Found`)**: `{ "error": "Document not found" }`.

---

## 4. Document Lifecycle & State Machine

```text
UPLOADED ──(conditional claim)──> PROCESSING ──(worker completion)──> COMPLETED
```

- **`UPLOADED`**: Set on document creation by API Lambda.
- **`PROCESSING`**: Claimed by Worker Lambda via conditional write:
  ```text
  attribute_exists(id) AND #status = 'UPLOADED'
  ```
- **`COMPLETED`**: Set when processed result JSON is saved to S3.
- **Role of `FAILED`**: A reserved terminal domain state for DLQ exhaustion or operator remediation. Worker processing errors are **re-thrown** for native SQS retry rather than marked `FAILED` prematurely.

---

## 5. S3 & SQS Pipeline

- **S3 Prefix Isolation**:
  - `uploads/{id}/original` (raw uploads)
  - `processed/{id}/result` (worker output JSON)
  - Notifications trigger **only** on `uploads/` to prevent infinite processing loops.
- **S3 Security**: Private bucket, all public access blocked, AES256 server-side encryption, TLS-only bucket policy.
- **SQS Queue**:
  - `VisibilityTimeout`: 180s (6x Lambda timeout of 30s).
  - `RedrivePolicy`: `maxReceiveCount: 3` targeting Dead Letter Queue (DLQ).
  - Queue policy restricts `SendMessage` strictly to the S3 bucket source ARN.
- **DLQ**: 14-day retention (`1209600`s) for poisoned or permanently failing messages.

---

## 6. Worker Processing

The Worker Lambda (`src/handlers/worker.handler.ts`):

1. **Ingests & Validates**: Decodes URL-encoded S3 key from SQS record and extracts document ID.
2. **Idempotent Claim**: Conditionally transitions state from `UPLOADED` to `PROCESSING`. If condition fails, inspects DynamoDB status: skips if `PROCESSING`, `COMPLETED`, or `FAILED`.
3. **Reads from S3**: Fetches content from `uploads/{id}/original`.
4. **Calculates Metrics**: Computes `lineCount`, `wordCount`, `characterCount`, and `originalSizeBytes`.
5. **Writes Result**: Saves JSON payload to `processed/{id}/result`.
6. **Updates DynamoDB**: Conditionally sets status to `COMPLETED` and records `processedS3Key`.
7. **Error Handling**: Failures are re-thrown to trigger native SQS retry / DLQ redrive without application retry counters.

---

## 7. DynamoDB Schema

Single-table design with primary key `id` (String):

| Field            | Type              | Description                                           |
| ---------------- | ----------------- | ----------------------------------------------------- |
| `id`             | String (Hash Key) | Document UUID                                         |
| `filename`       | String            | Original uploaded filename                            |
| `contentType`    | String            | MIME type                                             |
| `size`           | Number            | File size in bytes                                    |
| `status`         | String            | `UPLOADED` \| `PROCESSING` \| `COMPLETED` \| `FAILED` |
| `s3Key`          | String            | Original upload key                                   |
| `processedS3Key` | String?           | Output result key                                     |
| `createdAt`      | String            | ISO timestamp                                         |
| `updatedAt`      | String            | ISO timestamp                                         |

---

## 8. Least-Privilege IAM

| Principal                      | Resource                                                                                                                          | Actions                                                                                                                                                                                             | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **`ApiFunctionRole`**          | `DocumentsTable`<br>`DocumentsBucket/uploads/*`<br>`ApiLogGroup`                                                                  | `dynamodb:PutItem`, `dynamodb:GetItem`<br>`s3:PutObject`<br>`logs:CreateLogStream`, `logs:PutLogEvents`                                                                                             | Create/read documents & issue upload URLs                 |
| **`WorkerFunctionRole`**       | `DocumentsTable`<br>`DocumentsBucket/uploads/*`<br>`DocumentsBucket/processed/*`<br>`DocumentProcessingQueue`<br>`WorkerLogGroup` | `dynamodb:GetItem`, `dynamodb:UpdateItem`<br>`s3:GetObject`<br>`s3:PutObject`<br>`sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`<br>`logs:CreateLogStream`, `logs:PutLogEvents` | Claim, read, analyze, save result, and consume SQS events |
| **`s3.amazonaws.com`**         | `DocumentProcessingQueue`                                                                                                         | `sqs:SendMessage`                                                                                                                                                                                   | S3 ObjectCreated notifications (scoped to bucket ARN)     |
| **`apigateway.amazonaws.com`** | `ApiFunction`                                                                                                                     | `lambda:InvokeFunction`                                                                                                                                                                             | HTTP API request routing (scoped to API ARN)              |

---

## 9. Infrastructure as Code (CloudFormation)

- **[`infra/bootstrap.yaml`](infra/bootstrap.yaml)**: One-time deployment artifacts S3 bucket with TLS enforcement and 30-day lifecycle expiration (real AWS only; not used for local Floci).
- **[`infra/template.yaml`](infra/template.yaml)**: Complete application stack (HTTP API, API & Worker Lambdas, S3 Bucket & Policy, SQS & DLQ, DynamoDB Table, IAM Roles, CloudWatch Log Groups with 14-day retention).

---

## 10. AWS Deployment

### Commands

```bash
# 1. Deploy Bootstrap Stack (creates deployment artifacts S3 bucket)
aws cloudformation deploy \
  --template-file infra/bootstrap.yaml \
  --stack-name doc-pipeline-bootstrap

# 2. Build TypeScript Lambda bundles
npm run build

# 3. Package CloudFormation template (uploads dist/ bundles to S3)
aws cloudformation package \
  --template-file infra/template.yaml \
  --output-template-file infra/packaged.yaml \
  --s3-bucket <DEPLOYMENT_BUCKET_NAME>

# 4. Deploy pipeline stack
aws cloudformation deploy \
  --template-file infra/packaged.yaml \
  --stack-name serverless-doc-pipeline \
  --capabilities CAPABILITY_NAMED_IAM

# 5. Retrieve API endpoint & stack outputs
aws cloudformation describe-stacks \
  --stack-name serverless-doc-pipeline \
  --query "Stacks[0].Outputs"
```

---

## 11. Local Verification with Floci

Used solely for manual verification. Contains zero Floci-specific application code. **No bootstrap stack is needed for Floci**; create a local bucket directly using `aws s3 mb`:

```powershell
# Point AWS CLI to local Floci
$env:AWS_ENDPOINT_URL = "http://localhost:4566"

# 1. Create local deployment bucket directly
aws s3 mb s3://local-artifacts

# 2. Build & package application
npm run build
aws cloudformation package --template-file infra/template.yaml --output-template-file infra/packaged.yaml --s3-bucket local-artifacts

# 3. Deploy stack
aws cloudformation deploy --template-file infra/packaged.yaml --stack-name serverless-doc-pipeline --capabilities CAPABILITY_NAMED_IAM
```

---

## 12. Testing & Project Structure

All unit tests run **100% offline** without AWS credentials, Floci, or Docker:

```bash
npm test             # Run unit tests
npm run lint         # Check code quality
npm run format:check # Verify Prettier style
npm run typecheck    # Strict TypeScript validation
npm run build        # Build Lambda bundles with esbuild
```

```text
src/
├── api/          # Hono app factory, routes (documents.ts), input validators
├── clients/      # AWS SDK v3 client factories (DynamoDB DocumentClient, S3)
├── handlers/     # Lambda adapters: api.handler.ts (handle(app)), worker.handler.ts
├── repositories/ # DynamoDB repository with conditional writes
├── services/     # DocumentService, S3StorageService, DocumentProcessor
├── storage/      # Deterministic S3 key helpers & path traversal guards
└── types/        # Domain interfaces & DocumentStatus state transitions

infra/            # CloudFormation template.yaml & bootstrap.yaml
tests/unit/       # Offline Vitest suites (domain, repository, S3, API, worker, security)
```

---

## 13. Limitations

- **Text Processing Only**: Deterministic text metrics demo instead of heavy OCR/ML processing.
- **Unauthenticated HTTP API**: Focuses on event-driven mechanics without Cognito/auth layers.
- **Single-Region**: Designed for single-region deployment per stack.
