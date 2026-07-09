import { describe, expect, it } from 'vitest';

import type { LoopContractV1 } from '../../electron/loop-contract.js';
import { evaluateLoopContract } from '../../electron/loop-evaluator.js';

function contract(criteria: LoopContractV1['successCriteria']): LoopContractV1 {
  return {
    schemaVersion: 'loop_contract_v1',
    objective: 'Produce a checked output.',
    triggerPolicy: { kind: 'manual' },
    successCriteria: criteria,
    stopPolicy: { maxConsecutiveFailures: 3 },
    permissionPolicy: {
      mode: 'workspace_write',
      autoRunApproved: false,
      allowedToolCategories: ['file_write'],
      approvedTargetRefs: [],
    },
    concurrencyPolicy: {
      perLoop: 'skip_if_running',
      coalesceMissedRuns: false,
    },
  };
}

describe('loop evaluator', () => {
  it('requires all strong criteria to pass before returning success', async () => {
    const result = await evaluateLoopContract({
      runId: 'run-1',
      contract: contract([
        { kind: 'file_exists', pathTemplate: '${outputDirectory}/${outputFileName}', minBytes: 1 },
        { kind: 'command_exit_zero', commandId: 'npm-test', args: [], cwdPolicy: 'workspace' },
        { kind: 'task_completed', strength: 'weak' },
      ]),
      registry: {
        file_exists: async () => ({ status: 'passed', evidenceIds: ['file-evidence'], summary: 'file exists' }),
        command_exit_zero: async () => ({ status: 'passed', evidenceIds: ['command-evidence'], summary: 'command passed' }),
      },
      evidenceBundle: {},
    });

    expect(result).toEqual({
      status: 'success',
      evidenceIds: ['file-evidence', 'command-evidence'],
      summary: 'All strong success criteria passed.',
    });
  });

  it('blocks when any strong criterion blocks and ignores weak-only success for terminal state', async () => {
    const result = await evaluateLoopContract({
      runId: 'run-1',
      contract: contract([
        { kind: 'file_exists', pathTemplate: '${outputDirectory}/${outputFileName}', minBytes: 1 },
        { kind: 'task_completed', strength: 'weak' },
      ]),
      registry: {
        file_exists: async () => ({
          status: 'blocked',
          evidenceIds: ['missing-file-diagnostic'],
          nextActionKind: 'write_required_file',
          nextActionSummary: 'Write the required output file.',
        }),
      },
      evidenceBundle: {},
    });

    expect(result).toEqual({
      status: 'blocked',
      evidenceIds: ['missing-file-diagnostic'],
      nextActionKind: 'write_required_file',
      nextActionSummary: 'Write the required output file.',
    });
  });

  it('fails closed when a strong verifier is missing or throws', async () => {
    await expect(evaluateLoopContract({
      runId: 'run-1',
      contract: contract([
        { kind: 'file_exists', pathTemplate: '${outputDirectory}/${outputFileName}', minBytes: 1 },
      ]),
      registry: {},
      evidenceBundle: {},
    })).resolves.toEqual({
      status: 'blocked',
      evidenceIds: [],
      nextActionKind: 'register_verifier',
      nextActionSummary: 'No verifier is registered for loop criterion: file_exists.',
    });

    await expect(evaluateLoopContract({
      runId: 'run-2',
      contract: contract([
        { kind: 'file_exists', pathTemplate: '${outputDirectory}/${outputFileName}', minBytes: 1 },
      ]),
      registry: {
        file_exists: async () => {
          throw new Error('disk unavailable');
        },
      },
      evidenceBundle: {},
    })).resolves.toEqual({
      status: 'blocked',
      evidenceIds: [],
      nextActionKind: 'verifier_unavailable',
      nextActionSummary: 'Loop criterion verifier file_exists failed: disk unavailable',
    });
  });

  it('blocks weak-only contracts instead of treating task_completed as proof', async () => {
    const result = await evaluateLoopContract({
      runId: 'run-1',
      contract: {
        ...contract([{ kind: 'task_completed', strength: 'weak' }]),
        legacyPolicy: { requiresHumanApprovalBeforeBackgroundSuccess: true },
      },
      registry: {
        task_completed: async () => ({ status: 'passed', evidenceIds: ['answer-evidence'], summary: 'agent says done' }),
      },
      evidenceBundle: {},
    });

    expect(result).toEqual({
      status: 'blocked',
      evidenceIds: [],
      nextActionKind: 'add_success_criterion',
      nextActionSummary: 'Add at least one strong success criterion before this loop can be marked successful.',
    });
  });
});
