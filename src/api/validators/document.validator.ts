import type { CreateDocumentInput } from '../../services/document.service.js';

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  error: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function validateCreateDocumentRequest(
  body: unknown,
): ValidationResult<CreateDocumentInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      success: false,
      error: 'Request body must be a JSON object',
    };
  }

  const { filename, contentType, size } = body as Record<string, unknown>;

  if (typeof filename !== 'string' || filename.trim() === '') {
    return {
      success: false,
      error: 'Field "filename" is required and must be a non-empty string',
    };
  }

  if (typeof contentType !== 'string' || contentType.trim() === '') {
    return {
      success: false,
      error: 'Field "contentType" is required and must be a non-empty string',
    };
  }

  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    return {
      success: false,
      error: 'Field "size" is required and must be a positive integer',
    };
  }

  return {
    success: true,
    data: {
      filename: filename.trim(),
      contentType: contentType.trim(),
      size,
    },
  };
}

export function validateDocumentId(id: unknown): ValidationResult<string> {
  if (typeof id !== 'string' || id.trim() === '') {
    return {
      success: false,
      error: 'Document ID must be a non-empty string',
    };
  }

  return {
    success: true,
    data: id.trim(),
  };
}
