import type { LoopContractV1, LoopSuccessCriterion } from './loop-contract.js';
import type { LoopRunFailureKind } from './loop-types.js';

export type LoopCriterionVerification =
  | { status: 'passed'; evidenceIds?: string[]; summary?: string }
  | { status: 'blocked'; evidenceIds?: string[]; nextActionKind?: string; nextActionSummary?: string }
  | { status: 'failed'; evidenceIds?: string[]; failureKind?: LoopRunFailureKind; message?: string };

export type LoopEvaluation =
  | { status: 'success'; evidenceIds: string[]; summary: string }
  | { status: 'blocked'; evidenceIds: string[]; nextActionKind: string; nextActionSummary: string }
  | { status: 'failed'; evidenceIds: string[]; failureKind: LoopRunFailureKind; message: string };

export type LoopCriterionVerifier<C extends LoopSuccessCriterion = LoopSuccessCriterion> = (input: {
  runId: string;
  contract: LoopContractV1;
  criterion: C;
  evidenceBundle: unknown;
}) => LoopCriterionVerification | Promise<LoopCriterionVerification>;

export type LoopVerifierRegistry = Partial<{
  [K in LoopSuccessCriterion['kind']]: LoopCriterionVerifier<Extract<LoopSuccessCriterion, { kind: K }>>;
}>;

export interface EvaluateLoopContractInput {
  runId: string;
  contract: LoopContractV1;
  registry: LoopVerifierRegistry;
  evidenceBundle: unknown;
}

export async function evaluateLoopContract(input: EvaluateLoopContractInput): Promise<LoopEvaluation> {
  const strongCriteria = input.contract.successCriteria.filter(isStrongCriterion);
  if (strongCriteria.length === 0) {
    return {
      status: 'blocked',
      evidenceIds: [],
      nextActionKind: 'add_success_criterion',
      nextActionSummary: 'Add at least one strong success criterion before this loop can be marked successful.',
    };
  }

  const evidenceIds: string[] = [];
  for (const criterion of strongCriteria) {
    const verifier = input.registry[criterion.kind] as LoopCriterionVerifier | undefined;
    if (!verifier) {
      return {
        status: 'blocked',
        evidenceIds: [],
        nextActionKind: 'register_verifier',
        nextActionSummary: `No verifier is registered for loop criterion: ${criterion.kind}.`,
      };
    }

    let result: LoopCriterionVerification;
    try {
      result = await verifier({
        runId: input.runId,
        contract: input.contract,
        criterion,
        evidenceBundle: input.evidenceBundle,
      });
    } catch (error) {
      return {
        status: 'blocked',
        evidenceIds: [],
        nextActionKind: 'verifier_unavailable',
        nextActionSummary: `Loop criterion verifier ${criterion.kind} failed: ${readErrorMessage(error)}`,
      };
    }

    if (result.status === 'passed') {
      evidenceIds.push(...(result.evidenceIds ?? []));
      continue;
    }

    if (result.status === 'failed') {
      return {
        status: 'failed',
        evidenceIds: result.evidenceIds ?? [],
        failureKind: result.failureKind ?? 'validation_failed',
        message: result.message ?? `Loop criterion failed: ${criterion.kind}`,
      };
    }

    return {
      status: 'blocked',
      evidenceIds: result.evidenceIds ?? [],
      nextActionKind: result.nextActionKind ?? 'criterion_blocked',
      nextActionSummary: result.nextActionSummary ?? `Loop criterion blocked: ${criterion.kind}`,
    };
  }

  return {
    status: 'success',
    evidenceIds,
    summary: 'All strong success criteria passed.',
  };
}

function isStrongCriterion(criterion: LoopSuccessCriterion): boolean {
  return criterion.kind !== 'task_completed' || criterion.strength === 'strong';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
