import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../../src/runtime/task-host/task-runtime-host.js';
import { isDeliveryPlanComplete, runDeliverableGate } from '../../../src/runtime/task-host/deliverable-gate.js';
import { compactProjectCreationResponse } from '../../../src/runtime/task-host/tool-result-response.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

const prompt = '创建一个项目，让4个智能体分析附件的一份方案，产出一份新版方案';
const receipt = { ok: true, created: true, projectId: 'proj-example', project: { id: 'proj-example', name: 'Example project', status: 'active' }, planningStart: { sent: true } };
const steps = [{ id: 'create', label: '创建项目', status: 'completed' as const }, { id: 'delivery', label: '项目后台交付', status: 'running' as const }];
function snapshot(response = JSON.stringify(receipt), userPrompt = prompt): TaskSnapshot {
  return { taskId: 'example-task', sessionId: 'example-session', prompt: userPrompt, status: 'running', materials: [], createdAt: 1, updatedAt: 1,
    events: [{ type: 'canvas_tool_result', toolName: 'create_project', toolUseId: 'create-call', eventId: 'create-result', ok: true, response },
      { type: 'progress_plan_reported', steps }] };
}
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('confirmed project handoff delivery', () => {
  it('completes only the foreground handoff and preserves the unfinished project plan', async () => {
    const s = snapshot(compactProjectCreationResponse(JSON.stringify(receipt))!);
    const original = structuredClone(s); const gate = vi.fn();
    expect(isDeliveryPlanComplete(s)).toBe(true);
    expect(await runDeliverableGate(s, gate, new AbortController().signal)).toBe(true);
    expect(gate).not.toHaveBeenCalled(); expect(s).toEqual(original);
  });
  it.each([
    { ...receipt, planningStart: { sent: false } },
    { ...receipt, planningStart: undefined },
    { ...receipt, error: 'planning_failed' },
    { ...receipt, ok: false },
    { ...receipt, created: false },
    { ...receipt, projectId: 'another-project' },
    { ok: true, proposal: { kind: 'project_proposal' } },
  ])('keeps incomplete plans blocked without a confirmed launch: %j', invalid => {
    expect(isDeliveryPlanComplete(snapshot(JSON.stringify(invalid)))).toBe(false);
  });
  it.each(['不要创建项目，只生成一份报告和一份PPT', '查询创建项目接口，解释一份报告和一份方案',
    '如果需要就创建项目，输出一份报告和一份方案', '创建一个项目，同时在当前会话交付一份报告和一份PPT',
    '创建一个项目，不要后台执行，交付一份报告和一份方案', '是否创建项目，给一份报告和一份方案？'])('does not waive mixed, conditional or non-creation requests: %s', text => {
    expect(isDeliveryPlanComplete(snapshot(JSON.stringify(receipt), text))).toBe(false);
  });
  it('does not use an earlier success after the latest creation attempt failed', () => {
    const s = snapshot(); s.events.push({ ...s.events[0] as Extract<TaskSnapshot['events'][number], {type: 'canvas_tool_result'}>, ok: false });
    expect(isDeliveryPlanComplete(s)).toBe(false);
  });
  it.each([false, true])('settles the real host exactly once without retrying creation; explicit=%s', async explicit => {
    const root = mkdtempSync(join(tmpdir(), 'project-handoff-')); roots.push(root);
    const runner = vi.fn<TaskRunner>(async ({ sessionId, emitRuntimeEvent }) => {
      await emitRuntimeEvent({ type: 'post_tool_use', sessionId, turnId: 'turn', toolName: 'create_project', toolInput: {}, toolResponse: JSON.stringify(receipt), toolUseId: 'create-call' });
      await emitRuntimeEvent({ type: 'progress_plan_reported', sessionId, steps });
      await emitRuntimeEvent({ type: 'receipt_emitted', sessionId, turnId: 'turn', intentId: 'intent', stepId: 'step', note: 'Project created; background execution continues.' });
    });
    const host = new InProcessTaskRuntimeHost({ materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'workspace'), maxBytes: 1024 }), snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), runner,
      getExecutionPolicy: () => ({ deliveryRepair: explicit ? 'explicit' : 'automatic' }), authorizePreparation: () => {},
      onDeliveryReport: async report => structuredClone(report), aheGuards: { artifactEvidence: true } });
    host.bindMultiAgentRecovery(Promise.resolve());
    try {
      const task = explicit ? await host.prepareTask({ prompt, materials: [] }, { reservation: host.reserveTaskIdentity(), marker: { groupId: 'g', rootEpoch: 1, rootTurnId: 'r', preparationId: 'p', bootId: 'b' } }) : await host.prepareTask({ prompt, materials: [] });
      await host.startTask(task.taskId); await host.drain(); const recovered = (await host.recoverTask(task.taskId)).snapshot;
      expect(recovered.status, JSON.stringify({ delivery: recovered.hostDelivery, errors: recovered.events.filter(e => e.type === 'error') })).toBe('completed'); expect(runner).toHaveBeenCalledTimes(1);
      expect(recovered.events.filter(e => e.type === 'progress_plan_reported').at(-1)).toEqual({ type: 'progress_plan_reported', steps });
      if (explicit) expect(recovered.hostDelivery?.verification).toBe('passed');
    } finally { host.stopAccepting(); host.abortAllActive(); await host.drain(); }
  });
});
