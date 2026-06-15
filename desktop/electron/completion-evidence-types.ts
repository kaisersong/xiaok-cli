import type {
  CompletionEvidenceRecord as RuntimeCompletionEvidenceRecord,
  CompletionExpectation as RuntimeCompletionExpectation,
  CompletionKind as RuntimeCompletionKind,
  EvidenceValidationFailure,
  EvidenceValidationResult,
} from '../../src/runtime/guards/completion-evidence.js';

export type CompletionKind = RuntimeCompletionKind;
export type CompletionOwnerKind = RuntimeCompletionExpectation['ownerKind'];
export type CompletionRecordStatus = 'completed' | 'blocked';
export type CompletionEvidenceValidationFailure = EvidenceValidationFailure;
export type { EvidenceValidationResult };

export interface CompletionExpectation extends RuntimeCompletionExpectation {}

export interface CompletionEvidenceRecord extends RuntimeCompletionEvidenceRecord {}

export interface CompletionExpectationUpsertInput extends CompletionExpectation {
  id?: string;
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface CompletionEvidenceInsertInput extends CompletionEvidenceRecord {
  id?: string;
  now?: number;
}

export interface StoredCompletionExpectation extends CompletionExpectation {
  id: string;
  schemaVersion: 1;
  metadata: Record<string, unknown>;
  metadataJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredCompletionEvidenceRecord extends CompletionEvidenceRecord {
  id: string;
  schemaVersion: 1;
  metadata: Record<string, unknown>;
  metadataJson: string;
  createdAt: number;
  orphanedAt?: number;
}

export interface CompleteOwnerWithEvidenceInput {
  ownerKind: CompletionOwnerKind;
  ownerId: string;
  recordId?: string;
  now?: number;
}

export interface CompletionValidationRecord {
  id: string;
  ownerKind: CompletionOwnerKind;
  ownerId: string;
  status: CompletionRecordStatus;
  ok: boolean;
  failureKind?: CompletionEvidenceValidationFailure;
  message?: string;
  expectationId?: string;
  evidenceIds: string[];
  createdAt: number;
}

export interface CompletionRecordFilter {
  ownerKind?: CompletionOwnerKind;
  ownerId?: string;
  status?: CompletionRecordStatus;
}
