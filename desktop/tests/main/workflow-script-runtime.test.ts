import { describe, expect, it } from 'vitest';

import { runWorkflowScript } from '../../electron/workflow-script-runtime.js';

const script = `export const meta = {
  name: 'report_review',
  description: '复核报告事实、证据和交付质量',
  phases: [
    { title: '检查产物' },
    { title: '交叉复核' },
    { title: '归约结论' },
  ],
}

phase('检查产物')
const inventory = await agent('检查报告产物、引用和结构。', { label: '产物检查' })

phase('交叉复核')
const reviews = await parallel([
  () => agent(\`基于 \${inventory.summary} 做事实复核。\`, { label: '事实复核' }),
  () => agent('从证据充分性角度复核。', { label: '证据复核' }),
])

phase('归约结论')
return await agent(\`综合 \${reviews.map((item) => item.summary).join('、')}，输出 gate 建议。\`, { label: '归约结论' })
`;

describe('workflow script runtime', () => {
  it('executes safe Pi-style orchestration primitives through an injected controller', async () => {
    const phases: string[] = [];
    const calls: Array<{ label: string; phaseTitle: string | null; prompt: string }> = [];
    let activeCalls = 0;
    let maxActiveCalls = 0;

    const result = await runWorkflowScript(script, {
      concurrency: 2,
      controller: {
        async emitPhase(input) {
          phases.push(input.title);
        },
        async createAgentNode(input) {
          calls.push({
            label: input.label,
            phaseTitle: input.phaseTitle,
            prompt: input.prompt,
          });
          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          await Promise.resolve();
          activeCalls -= 1;
          return { summary: input.label, prompt: input.prompt };
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.meta.name).toBe('report_review');
    expect(result.scriptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.result).toEqual({
      summary: '归约结论',
      prompt: '综合 事实复核、证据复核，输出 gate 建议。',
    });
    expect(phases).toEqual(['检查产物', '交叉复核', '归约结论']);
    expect(calls.map((call) => call.label)).toEqual(['产物检查', '事实复核', '证据复核', '归约结论']);
    expect(calls.map((call) => call.phaseTitle)).toEqual(['检查产物', '交叉复核', '交叉复核', '归约结论']);
    expect(calls[1].prompt).toBe('基于 产物检查 做事实复核。');
    expect(maxActiveCalls).toBe(2);
  });

  it('rejects forbidden APIs before execution reaches the controller', async () => {
    let agentCalled = false;

    await expect(runWorkflowScript(
      `export const meta = { name: 'unsafe_demo', description: 'desc' }
process.env.OPENAI_API_KEY
await agent('x')`,
      {
        controller: {
          async createAgentNode() {
            agentCalled = true;
            return { ok: true };
          },
        },
      },
    )).rejects.toMatchObject({ code: 'workflow_script_forbidden_api' });
    expect(agentCalled).toBe(false);
  });

  it('supports pipeline stages as rest arguments before a final agent call', async () => {
    const result = await runWorkflowScript(
      `export const meta = { name: 'pipeline_demo', description: 'pipeline demo' }
phase('归纳')
return await pipeline(
  'seed',
  (value) => value + ':checked',
  (value) => agent(value, { label: '管线归纳' }),
)`,
      {
        controller: {
          async createAgentNode(input) {
            return { summary: input.label, prompt: input.prompt };
          },
        },
      },
    );

    expect(result.result).toEqual({ summary: '管线归纳', prompt: 'seed:checked' });
  });

  it('registers durable parallel groups and annotates branch agent nodes', async () => {
    const groups: Array<{ label: string; totalCount: number; limit: number; failurePolicy: string }> = [];
    const calls: Array<{ label: string; parallelGroupId: string | null; fanoutItemKey: string | null; fanoutItemLabel: string | null }> = [];

    await runWorkflowScript(
      `export const meta = { name: 'parallel_demo', description: 'parallel demo' }
phase('交叉复核')
return await parallel([
  () => agent('事实复核', { label: '事实复核' }),
  () => agent('证据复核', { label: '证据复核' }),
], { label: '两路复核', limit: 2, failurePolicy: 'required_all' })`,
      {
        concurrency: 2,
        controller: {
          async beginParallelGroup(input) {
            groups.push({
              label: input.label,
              totalCount: input.totalCount,
              limit: input.limit,
              failurePolicy: input.failurePolicy,
            });
            return { parallelGroupId: 'script-parallel-1' };
          },
          async createAgentNode(input) {
            calls.push({
              label: input.label,
              parallelGroupId: input.parallelGroupId,
              fanoutItemKey: input.fanoutItemKey,
              fanoutItemLabel: input.fanoutItemLabel,
            });
            return { summary: input.label };
          },
        },
      },
    );

    expect(groups).toEqual([
      { label: '两路复核', totalCount: 2, limit: 2, failurePolicy: 'required_all' },
    ]);
    expect(calls).toEqual([
      { label: '事实复核', parallelGroupId: 'script-parallel-1', fanoutItemKey: 'branch-1', fanoutItemLabel: '事实复核' },
      { label: '证据复核', parallelGroupId: 'script-parallel-1', fanoutItemKey: 'branch-2', fanoutItemLabel: '证据复核' },
    ]);
  });

  it('rejects non-thunk parallel branch items at runtime', async () => {
    await expect(runWorkflowScript(
      `export const meta = { name: 'bad_parallel_runtime', description: 'bad parallel runtime' }
phase('复核')
return await parallel([
  'not a thunk',
  () => agent('证据复核', { label: '证据复核' }),
])`,
      {
        controller: {
          async createAgentNode(input) {
            return { summary: input.label };
          },
        },
      },
    )).rejects.toMatchObject({ code: 'workflow_script_parallel_thunk_required' });
  });

  it('collects branch failures when parallel failurePolicy is collect_errors', async () => {
    const result = await runWorkflowScript(
      `export const meta = { name: 'parallel_collect_errors_demo', description: 'parallel collect errors demo' }
phase('交叉复核')
return await parallel([
  () => agent('事实复核', { label: '事实复核' }),
  () => agent('证据复核', { label: '证据复核' }),
], { label: '两路复核', failurePolicy: 'collect_errors' })`,
      {
        controller: {
          async createAgentNode(input) {
            if (input.label === '证据复核') throw Object.assign(new Error('缺少证据引用'), { code: 'missing_evidence' });
            return { summary: input.label };
          },
        },
      },
    );

    expect(result.result).toEqual([
      { ok: true, value: { summary: '事实复核' } },
      { ok: false, error: 'missing_evidence', message: '缺少证据引用', branch: '证据复核' },
    ]);
  });

  it('returns quorum successes when parallel failurePolicy is quorum', async () => {
    const result = await runWorkflowScript(
      `export const meta = { name: 'parallel_quorum_demo', description: 'parallel quorum demo' }
phase('交叉复核')
return await parallel([
  () => agent('事实复核', { label: '事实复核' }),
  () => agent('证据复核', { label: '证据复核' }),
  () => agent('格式复核', { label: '格式复核' }),
], { label: '三路复核', failurePolicy: 'quorum', quorum: 2 })`,
      {
        controller: {
          async createAgentNode(input) {
            if (input.label === '证据复核') throw Object.assign(new Error('证据不足'), { code: 'insufficient_evidence' });
            return { summary: input.label };
          },
        },
      },
    );

    expect(result.result).toEqual([
      { summary: '事实复核' },
      { summary: '格式复核' },
    ]);
  });

  it('supports terminal workflow block primitive', async () => {
    const result = await runWorkflowScript(
      `export const meta = { name: 'blocked_demo', description: 'blocked demo' }
phase('复核')
await agent('检查证据', { label: '证据检查' })
workflow.block({ reason: '缺少 HTML 交付物', evidenceRefs: ['artifacts/report.md'] })`,
      {
        controller: {
          async createAgentNode(input) {
            return { summary: input.label };
          },
        },
      },
    );

    expect(result.result).toEqual({
      status: 'blocked',
      reason: '缺少 HTML 交付物',
      evidenceRefs: ['artifacts/report.md'],
    });
    expect(result.terminal).toEqual({
      status: 'blocked',
      reason: '缺少 HTML 交付物',
      evidenceRefs: ['artifacts/report.md'],
    });
  });

  it('reserves and consumes budget with stable run/node/attempt ids', async () => {
    const calls: string[] = [];
    const controller = {
      async reserveBudget(input: any) {
        calls.push(`reserve:${input.runId}:${input.nodeId}:${input.tokens}`);
        return { reserved: true, attemptId: `${input.nodeId}-attempt-1` };
      },
      async consumeBudget(input: any) {
        calls.push(`consume:${input.runId}:${input.nodeId}:${input.attemptId}:${input.reserved}:${input.actual}:${input.usageSource}`);
      },
      async releaseBudget(input: any) {
        calls.push(`release:${input.runId}:${input.nodeId}:${input.attemptId}:${input.tokens}`);
      },
      async checkRemainingBudget() {
        return 100;
      },
      async markBranchSkipped() {},
      async createAgentNode(input: any) {
        calls.push(`dispatch:${input.nodeId}:${input.attemptId}`);
        return { summary: 'ok', usage: { totalTokens: 17 } };
      },
    };

    await runWorkflowScript(
      `export const meta = { name: 'budget_demo', description: 'budget demo' }
return await agent('检查报告', { label: '检查', estimatedTokens: 20 })`,
      {
        workflowRunId: 'run-1',
        controller,
        policy: { budget: { maxTokens: 100, defaultEstimateMultiplier: 1 } },
      } as any,
    );

    expect(calls).toEqual([
      'reserve:run-1:node-run-1-1:20',
      'dispatch:node-run-1-1:node-run-1-1-attempt-1',
      'consume:run-1:node-run-1-1:node-run-1-1-attempt-1:20:17:provider',
    ]);
  });

  it('retries evidence failures with a fresh attempt and bypasses completed-node cache', async () => {
    const dispatches: Array<{ nodeId: string; attemptId: string; forceRetry?: boolean }> = [];
    const consumed: string[] = [];
    let attempt = 0;
    let verifyCount = 0;
    const controller = {
      async reserveBudget(input: any) {
        attempt += 1;
        return { reserved: true, attemptId: `${input.nodeId}-attempt-${attempt}` };
      },
      async consumeBudget(input: any) {
        consumed.push(`${input.nodeId}:${input.attemptId}:${input.actual}`);
      },
      async releaseBudget() {},
      async checkRemainingBudget() {
        return 100;
      },
      async markBranchSkipped() {},
      async markNodeIntervention() {
        throw new Error('should not need intervention');
      },
      async verifyEvidence(input: any) {
        verifyCount += 1;
        expect(input.runId).toBe('run-ev');
        expect(input.nodeId).toBe('node-run-ev-1');
        return verifyCount === 1
          ? { ok: false, failures: ['missing summary'], warnings: [] }
          : { ok: true, failures: [], warnings: ['short output'] };
      },
      async createAgentNode(input: any) {
        dispatches.push({ nodeId: input.nodeId, attemptId: input.attemptId, forceRetry: input.forceRetry });
        return input.forceRetry
          ? { summary: 'second', usage: { totalTokens: 8 } }
          : { text: 'first', usage: { totalTokens: 7 } };
      },
    };

    const result = await runWorkflowScript(
      `export const meta = { name: 'evidence_demo', description: 'evidence demo' }
return await agent('生成报告', { label: '生成', estimatedTokens: 10 })`,
      {
        workflowRunId: 'run-ev',
        workspaceRoot: '/tmp/workspace',
        controller,
        policy: {
          budget: { maxTokens: 100, defaultEstimateMultiplier: 1 },
          evidenceGate: {
            maxRetry: 2,
            retryPolicy: 'refetch',
            checks: [{ kind: 'output_schema', requiredKeys: ['summary'] }],
          },
        },
      } as any,
    );

    expect(result.result).toEqual({ summary: 'second', usage: { totalTokens: 8 } });
    expect(dispatches).toEqual([
      { nodeId: 'node-run-ev-1', attemptId: 'node-run-ev-1-attempt-1', forceRetry: undefined },
      { nodeId: 'node-run-ev-1', attemptId: 'node-run-ev-1-attempt-2', forceRetry: true },
    ]);
    expect(consumed).toEqual([
      'node-run-ev-1:node-run-ev-1-attempt-1:7',
      'node-run-ev-1:node-run-ev-1-attempt-2:8',
    ]);
  });

  it('rejects agent options that specify both model and modelCapability before dispatch', async () => {
    let dispatched = false;
    await expect(runWorkflowScript(
      `export const meta = { name: 'model_capability_demo', description: 'model capability demo' }
await agent('分析', { model: 'gpt-5.4', modelCapability: 'deep-reviewer' })`,
      {
        controller: {
          async createAgentNode() {
            dispatched = true;
            return { ok: true };
          },
        },
      },
    )).rejects.toMatchObject({ code: 'model_and_capability_mutually_exclusive' });
    expect(dispatched).toBe(false);
  });

  it('marks parallel branches as budget_skipped when best-effort remaining budget is exhausted', async () => {
    const skipped: Array<{ nodeId: string; label: string }> = [];
    const dispatched: string[] = [];
    const result = await runWorkflowScript(
      `export const meta = { name: 'parallel_budget_demo', description: 'parallel budget demo' }
return await parallel([
  () => agent('分支一', { label: '分支一', estimatedTokens: 30 }),
  () => agent('分支二', { label: '分支二', estimatedTokens: 30 }),
  () => agent('分支三', { label: '分支三', estimatedTokens: 30 }),
])`,
      {
        workflowRunId: 'run-par',
        controller: {
          async checkRemainingBudget() {
            return 50;
          },
          async reserveBudget(input: any) {
            return { reserved: true, attemptId: `${input.nodeId}-attempt-1` };
          },
          async consumeBudget() {},
          async releaseBudget() {},
          async markBranchSkipped(input: any) {
            skipped.push({ nodeId: input.nodeId, label: input.label });
          },
          async createAgentNode(input: any) {
            dispatched.push(input.label);
            return { summary: input.label };
          },
        },
        policy: { budget: { maxTokens: 50, defaultEstimateMultiplier: 1 } },
      } as any,
    );

    expect(dispatched).toEqual(['分支一']);
    expect(skipped).toEqual([
      { nodeId: 'node-run-par-2', label: '分支 2' },
      { nodeId: 'node-run-par-3', label: '分支 3' },
    ]);
    expect(result.result).toEqual([
      { summary: '分支一' },
      { ok: false, error: 'budget_skipped', message: 'branch 2 skipped: budget exceeded', branch: '分支 2' },
      { ok: false, error: 'budget_skipped', message: 'branch 3 skipped: budget exceeded', branch: '分支 3' },
    ]);
  });
});
