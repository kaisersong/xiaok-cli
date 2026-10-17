// @vitest-environment node
import { expect, it } from 'vitest';
import { captureTask7Output, captureTask7Event } from '../../electron/task7-typed-ipc.js';
import { TASK7_ANSWER, TASK7_EVENT } from '../../shared/task7-ipc-contract.js';
const understanding = { goal: 'g', deliverable: 'd', taskType: 'unknown', audience: 'a', inputs: [{ materialId: 'm', name: 'n', role: 'unknown', parseStatus: 'parsed', parseSummary: 'p' }],
  missingInfo: ['i'], assumptions: ['a'], riskLevel: 'low', suggestedPlan: [{ id: 's', label: 's', status: 'completed' }], nextAction: 'n' };
const result = { summary: 's', artifacts: [{ artifactId: 'a', sourceTaskId: 'task', kind: 'text', title: 't', createdAt: '2026-10-12', previewAvailable: true, filePath: 'C:\\result.txt', mimeType: 'text/plain', sizeBytes: 1, sourceMaterialIds: ['m'], creator: 'agent' }], structuredOutput: { nested: [1, true, null] }, assumptions: ['a'], nextSteps: ['n'], degraded: false };
const events = [
  { type: 'execution_health', state: 'cleanup_pending' }, { type: 'task_started', taskId: 'task' }, { type: 'task_execution_started', taskId: 'task' }, { type: 'task_terminal', status: 'completed' },
  { type: 'understanding_updated', understanding }, { type: 'plan_updated', plan: understanding.suggestedPlan }, { type: 'progress', eventId: 'e', message: 'm', stage: 's' },
  { type: 'assistant_delta', eventId: 'e', delta: 'd' }, { type: 'needs_user', question: { questionId: 'q', taskId: 'task', kind: 'freeform', prompt: 'p', choices: [{ id: 'yes', label: 'yes' }], expectedAttachments: ['unknown'], staleAfterEventId: 'e' } },
  { type: 'question_resolved', questionId: 'q' }, { type: 'task_cancelled', taskId: 'task', reason: 'user', partialText: 'text' }, { type: 'result', result },
  { type: 'artifact_recorded', artifactId: 'a', kind: 'text', label: 'a', filePath: '/tmp/a.txt', previewAvailable: false, turnId: 't', creator: 'agent', mimeType: 'text/plain' },
  { type: 'salvage', salvage: { summary: ['saved'], reason: 'partial' } }, { type: 'error', message: 'm' },
  { type: 'canvas_tool_call', toolName: 'write', input: { path: '/tmp/a' }, toolUseId: 'u', eventId: 'e', ts: 1, displayInputSummary: 'write' },
  { type: 'canvas_tool_result', toolName: 'write', toolUseId: 'u', ok: true, response: 'ok', eventId: 'e', ts: 1 },
  { type: 'canvas_file_changed', filePath: '/tmp/a', change: 'add', eventId: 'e' }, { type: 'progress_plan_reported', steps: understanding.suggestedPlan },
  { type: 'usage_recorded', inputTokens: 1, outputTokens: 2 }, { type: 'goal_tool_fact', invocationId: 'i', toolName: 'write', factKind: 'file_mutation', exitCode: null, normalizedFilePaths: ['/tmp/a'] },
  { type: 'goal_tool_finished', invocationId: 'i', toolName: 'write', ok: true },
];
it('retains complete event population and optional understanding from actual production capture', () => {
  expect(events).toHaveLength(TASK7_EVENT.options.length);
  for (const event of events) expect(captureTask7Event(event)).toEqual(event);
  expect(captureTask7Output('createTask', { taskId: 'task', understanding })).toEqual({ taskId: 'task', understanding });
  expect(captureTask7Output('createTask', { taskId: 'task' })).toEqual({ taskId: 'task' });
});
it('retains all snapshot DTO fields, delivery deadline and historical protection markers without granting private authority', () => {
  const snapshot = { taskId: 'task', sessionId: 'thread', status: 'completed', prompt: 'p', materials: [{ materialId: 'm', originalName: 'm', role: 'unknown', parseStatus: 'parsed', parseSummary: 'p' }], events, understanding, result,
    salvage: { summary: ['partial'], reason: 'saved' }, context: { threadId: 'thread', taskIds: ['old'], loadedTaskIds: [], skipped: [{ taskId: 'old', reason: 'too_old' }] },
    executionScope: { kind: 'goal_turn', origin: 'user', goalId: 'g', epoch: 1, goalTurnId: 'turn', threadId: 'thread' }, multiAgentPreparation: { groupId: 'group', rootEpoch: 1, rootTurnId: 'turn', preparationId: 'p', bootId: 'b' },
    hostDelivery: { version: 1, revision: 1, status: 'unknown', stage: 'cleanup', verification: 'pending', hostSettlement: 'unknown', readerCleanup: 'pending', storeCleanup: 'none', startedAt: 1, deadlineAt: 30001, decisionAt: 2, finishedAt: 3, hostTerminalStatus: 'failed', guardFailure: { code: 'app_shutdown', stage: 'cleanup', needsExplicitFollowup: true } },
    usage: { inputTokens: 1, outputTokens: 2, known: true }, executionProtected: true, protectedObservationClosure: { version: 1, requiresReauthorization: true, observations: [{ authorityId: 'audit', profileId: 'profile', sourceSessionId: 'thread', ownerAgentId: 'agent', scopeId: 'scope', permissionGeneration: 1, observationId: 'o', contentHash: 'hash', revision: 1, policyId: 'p', policyRevision: 1 }] },
    currentCompletion: { kind: 'protected', state: { owner: { profileId: 'p', ownerKind: 'task', ownerId: 'task' }, migrationEpoch: 1, businessRevision: 1, obligationSetRevision: 1, obligationSetHash: 'hash', obligationCount: 1, currentVerification: 'unavailable' } }, createdAt: 1, updatedAt: 2 };
  expect(captureTask7Output('recoverTask', { snapshot, recoveredFromTaskId: 'task' })).toEqual({ snapshot, recoveredFromTaskId: 'task' });
  for (const privateField of ['control', 'authority', 'grants', 'principal']) expect(() => captureTask7Output('recoverTask', { snapshot: { ...snapshot, [privateField]: {} } })).toThrow('task_projection_unavailable');
  expect(() => captureTask7Output('recoverTask', { snapshot: { ...snapshot, hostDelivery: { ...snapshot.hostDelivery, deadlineAt: 'invalid' } } })).toThrow('task_projection_unavailable');
});
it('all four actual answer branches validate, and branch mismatch never becomes an answer', () => {
  for (const answer of [{ type: 'choice', questionId: 'q', choiceId: 'yes' }, { type: 'text', questionId: 'q', text: 'text' }, { type: 'materials', questionId: 'q', materialIds: ['m'] }, { type: 'role_update', questionId: 'q', materialId: 'm', role: 'customer_material' }]) expect(TASK7_ANSWER.safeParse(answer).success).toBe(true);
  expect(TASK7_ANSWER.safeParse({ type: 'choice', questionId: 'q', text: 'wrong' }).success).toBe(false);
});
