import type { CreateUserLoopTemplateInput } from './loop-types.js';
import type { LoopContractV1 } from '../../src/runtime/loop/contract.js';
export * from '../../src/runtime/loop/contract.js';

export function createDefaultLoopContract(input: CreateUserLoopTemplateInput): LoopContractV1 {
  const base = {
    schemaVersion: 'loop_contract_v1' as const,
    objective: input.prompt,
    triggerPolicy: { kind: 'manual' as const },
    stopPolicy: { maxConsecutiveFailures: 3 },
    concurrencyPolicy: {
      perLoop: 'skip_if_running' as const,
      coalesceMissedRuns: false,
    },
  };

  if (input.kind === 'task_completion') {
    return {
      ...base,
      successCriteria: [{ kind: 'task_completed', strength: 'weak' }],
      permissionPolicy: {
        mode: 'read_only',
        autoRunApproved: false,
        allowedToolCategories: [],
      },
      legacyPolicy: {
        requiresHumanApprovalBeforeBackgroundSuccess: true,
      },
    };
  }

  return {
    ...base,
    successCriteria: [
      {
        kind: 'file_exists',
        pathTemplate: '${outputDirectory}/${outputFileName}',
        minBytes: 1,
      },
    ],
    permissionPolicy: {
      mode: 'workspace_write',
      autoRunApproved: false,
      allowedToolCategories: ['file_write'],
      approvedTargetRefs: [],
    },
  };
}
