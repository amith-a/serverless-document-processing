export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export class InvalidStateTransitionError extends Error {
  constructor(from: DocumentStatus, to: DocumentStatus) {
    super(`Invalid document status transition from ${from} to ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

const allowedTransitions: Record<DocumentStatus, DocumentStatus[]> = {
  UPLOADED: ['PROCESSING'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export function canTransition(
  currentStatus: DocumentStatus,
  nextStatus: DocumentStatus,
): boolean {
  return allowedTransitions[currentStatus].includes(nextStatus);
}

export function transitionStatus(
  currentStatus: DocumentStatus,
  nextStatus: DocumentStatus,
): DocumentStatus {
  if (!canTransition(currentStatus, nextStatus)) {
    throw new InvalidStateTransitionError(currentStatus, nextStatus);
  }
  return nextStatus;
}
