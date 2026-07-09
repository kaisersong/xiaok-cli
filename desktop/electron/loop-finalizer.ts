import type { LoopRun } from './loop-types.js';
import { LoopStore } from './loop-store.js';
import type { LoopEvaluation } from './loop-evaluator.js';

export interface FinishLoopSuccessInput {
  runId: string;
  evidenceIds: string[];
  now: number;
  summary: string;
}

export interface FinishLoopEvaluationInput {
  runId: string;
  evaluation: LoopEvaluation;
  now: number;
}

export interface LoopFinalizer {
  finishSuccess(input: FinishLoopSuccessInput): LoopRun | undefined;
  finalizeEvaluation?(input: FinishLoopEvaluationInput): LoopRun | undefined;
}

export function createLoopFinalizer(loopStore: LoopStore): LoopFinalizer {
  return {
    finishSuccess(input) {
      return loopStore.finishLoopRunSuccess(input.runId, input.evidenceIds, input.now, input.summary);
    },
    finalizeEvaluation(input) {
      if (input.evaluation.status === 'success') {
        return loopStore.finishLoopRunSuccess(
          input.runId,
          input.evaluation.evidenceIds,
          input.now,
          input.evaluation.summary
        );
      }
      if (input.evaluation.status === 'blocked') {
        return loopStore.finishLoopRunBlocked(
          input.runId,
          input.evaluation.evidenceIds,
          input.evaluation.nextActionKind,
          input.evaluation.nextActionSummary,
          input.now
        );
      }
      return loopStore.finishLoopRunFailure(
        input.runId,
        input.evaluation.failureKind,
        input.evaluation.message,
        input.evaluation.evidenceIds,
        input.now
      );
    },
  };
}
