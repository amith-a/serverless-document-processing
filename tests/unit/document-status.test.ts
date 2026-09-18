import { describe, expect, it } from 'vitest';
import {
  canTransition,
  InvalidStateTransitionError,
  transitionStatus,
} from '../../src/types/document-status.js';

describe('canTransition', () => {
  it('allows UPLOADED to PROCESSING', () => {
    expect(canTransition('UPLOADED', 'PROCESSING')).toBe(true);
  });

  it('allows PROCESSING to COMPLETED', () => {
    expect(canTransition('PROCESSING', 'COMPLETED')).toBe(true);
  });

  it('allows PROCESSING to FAILED', () => {
    expect(canTransition('PROCESSING', 'FAILED')).toBe(true);
  });

  it('does not allow UPLOADED to COMPLETED', () => {
    expect(canTransition('UPLOADED', 'COMPLETED')).toBe(false);
  });

  it('does not allow COMPLETED to PROCESSING', () => {
    expect(canTransition('COMPLETED', 'PROCESSING')).toBe(false);
  });

  it('does not allow FAILED to PROCESSING', () => {
    expect(canTransition('FAILED', 'PROCESSING')).toBe(false);
  });

  it('does not allow a document to remain in the same status', () => {
    expect(canTransition('UPLOADED', 'UPLOADED')).toBe(false);
    expect(canTransition('PROCESSING', 'PROCESSING')).toBe(false);
    expect(canTransition('COMPLETED', 'COMPLETED')).toBe(false);
    expect(canTransition('FAILED', 'FAILED')).toBe(false);
  });
});

describe('transitionStatus', () => {
  it('returns nextStatus for valid transitions', () => {
    expect(transitionStatus('UPLOADED', 'PROCESSING')).toBe('PROCESSING');
    expect(transitionStatus('PROCESSING', 'COMPLETED')).toBe('COMPLETED');
    expect(transitionStatus('PROCESSING', 'FAILED')).toBe('FAILED');
  });

  it('throws InvalidStateTransitionError for UPLOADED to COMPLETED', () => {
    expect(() => transitionStatus('UPLOADED', 'COMPLETED')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('throws InvalidStateTransitionError for FAILED to PROCESSING', () => {
    expect(() => transitionStatus('FAILED', 'PROCESSING')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('throws InvalidStateTransitionError for self-transitions', () => {
    expect(() => transitionStatus('UPLOADED', 'UPLOADED')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => transitionStatus('PROCESSING', 'PROCESSING')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => transitionStatus('COMPLETED', 'COMPLETED')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => transitionStatus('FAILED', 'FAILED')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('throws InvalidStateTransitionError for transitions from terminal states', () => {
    expect(() => transitionStatus('COMPLETED', 'PROCESSING')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => transitionStatus('COMPLETED', 'FAILED')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => transitionStatus('FAILED', 'UPLOADED')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => transitionStatus('FAILED', 'COMPLETED')).toThrow(
      InvalidStateTransitionError,
    );
  });
});
