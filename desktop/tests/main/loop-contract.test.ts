import { describe, expect, it } from 'vitest';

import { parseLoopContractV1 } from '../../electron/loop-contract.js';

function validRawContract(): Record<string, unknown> {
  return {
    schemaVersion: 'loop_contract_v1',
    objective: 'Write a markdown report.',
    triggerPolicy: { kind: 'manual' },
    successCriteria: [
      { kind: 'file_exists', pathTemplate: '${outputDirectory}/${outputFileName}', minBytes: 1 },
    ],
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

describe('LoopContract parser', () => {
  it('accepts registered L1 criteria and returns a normalized v1 contract', () => {
    expect(parseLoopContractV1(validRawContract(), {
      registeredCriteria: ['file_exists', 'task_completed', 'command_exit_zero'],
    })).toEqual(validRawContract());
  });

  it('rejects unknown schema versions, top-level fields, and empty criteria', () => {
    expect(() => parseLoopContractV1({
      ...validRawContract(),
      schemaVersion: 'loop_contract_v2',
    }, { registeredCriteria: ['file_exists'] })).toThrow('Unsupported LoopContract schemaVersion: loop_contract_v2');

    expect(() => parseLoopContractV1({
      ...validRawContract(),
      unknownPolicy: {},
    }, { registeredCriteria: ['file_exists'] })).toThrow('Unknown LoopContract field: unknownPolicy');

    expect(() => parseLoopContractV1({
      ...validRawContract(),
      successCriteria: [],
    }, { registeredCriteria: ['file_exists'] })).toThrow('LoopContract successCriteria must not be empty.');
  });

  it('rejects success criteria without a registered verifier', () => {
    expect(() => parseLoopContractV1({
      ...validRawContract(),
      successCriteria: [
        { kind: 'http_check', url: 'https://example.com' },
      ],
    }, { registeredCriteria: ['file_exists', 'task_completed'] })).toThrow('Unsupported LoopContract success criterion: http_check');
  });

  it('rejects unsafe command_exit_zero criteria at parse time', () => {
    expect(() => parseLoopContractV1({
      ...validRawContract(),
      successCriteria: [
        { kind: 'command_exit_zero', commandId: 'npm-test', args: ['--watch; rm -rf ~'], cwdPolicy: 'workspace' },
      ],
    }, { registeredCriteria: ['command_exit_zero'] })).toThrow('LoopContract command_exit_zero arg 0 is unsafe.');

    expect(() => parseLoopContractV1({
      ...validRawContract(),
      successCriteria: [
        { kind: 'command_exit_zero', commandId: 'npm-test', args: [], cwdPolicy: 'repo-root' },
      ],
    }, { registeredCriteria: ['command_exit_zero'] })).toThrow('LoopContract command_exit_zero cwdPolicy is unsupported: repo-root');
  });
});
