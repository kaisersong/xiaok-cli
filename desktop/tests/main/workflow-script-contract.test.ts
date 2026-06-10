import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  createWorkflowScriptPreview,
  hashWorkflowScript,
  normalizeWorkflowScript,
  parseWorkflowScript,
  validateWorkflowScript,
} from '../../electron/workflow-script-contract.js';

const validScript = `export const meta = {
  name: 'report_review',
  description: '复核报告事实、证据和交付质量',
  phases: [
    { title: '检查产物', detail: '检查报告结构和引用' },
    { title: '交叉复核' },
    { title: '归约结论' },
  ],
}

phase('检查产物')
const inventory = await agent('检查报告产物、引用和结构。', { label: '产物检查' })

phase('交叉复核')
const reviews = await parallel([
  () => agent('从事实准确性角度复核。', { label: '事实复核' }),
  () => agent('从证据充分性角度复核。', { label: '证据复核' }),
])

phase('归约结论')
return await agent('综合检查和复核结果，输出 gate 建议。', { label: '归约结论' })
`;

describe('workflow script contract', () => {
  it('normalizes markdown fenced scripts before validation', () => {
    const normalized = normalizeWorkflowScript(`\n\`\`\`javascript\n${validScript}\n\`\`\`\n`);

    expect(normalized).toMatch(/^export const meta/);
    expect(normalized).not.toContain('```');
  });

  it('parses Pi-style literal metadata and script body without executing it', () => {
    const parsed = parseWorkflowScript(validScript);

    expect(parsed.meta.name).toBe('report_review');
    expect(parsed.meta.description).toBe('复核报告事实、证据和交付质量');
    expect(parsed.meta.phases?.map((phase) => phase.title)).toEqual(['检查产物', '交叉复核', '归约结论']);
    expect(parsed.body).toMatch(/parallel/);
    expect(parsed.body).not.toMatch(/export const meta/);
  });

  it('validates safe orchestration primitives and returns proposal-ready analysis', () => {
    const result = validateWorkflowScript(validScript, {
      policy: { maxScriptBytes: 8000, maxAgentCalls: 8 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.normalized.meta.name).toBe('report_review');
    expect(result.normalized.analysis.agentCallCount).toBe(4);
    expect(result.normalized.analysis.parallelCallCount).toBe(1);
    expect(result.normalized.analysis.pipelineCallCount).toBe(0);
    expect(result.normalized.analysis.runtimePhaseTitles).toEqual(['检查产物', '交叉复核', '归约结论']);
    expect(result.normalized.scriptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates proposal preview metadata for KSwarm without exposing raw script body', () => {
    const preview = createWorkflowScriptPreview(validScript, {
      projectId: 'proj-script',
      taskId: 'task-1',
      requestedBy: 'xiaok-po',
      now: 1770000000000,
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.workflowId).toBe('report_review');
    expect(preview.source).toBe('script_generated');
    expect(preview.scope).toEqual({ projectId: 'proj-script', taskId: 'task-1' });
    expect(preview.status).toBe('pending_confirmation');
    expect('scriptBody' in preview).toBe(false);
    expect(preview.scriptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.phases.map((phase) => phase.title)).toEqual(['检查产物', '交叉复核', '归约结论']);
    expect(preview.analysis.agentCallCount).toBe(4);
  });

  it('rejects metadata that is not the first literal export', () => {
    expect(validateWorkflowScript("const name = 'demo'\nexport const meta = { name: 'demo', description: 'desc' }\nawait agent('x')")).toMatchObject({
      ok: false,
      error: 'workflow_script_meta_first_required',
    });
    expect(validateWorkflowScript("export const meta = { name: makeName(), description: 'desc' }\nawait agent('x')")).toMatchObject({
      ok: false,
      error: 'workflow_script_meta_literal_required',
    });
    expect(validateWorkflowScript("export const meta = { ...base, name: 'demo', description: 'desc' }\nawait agent('x')")).toMatchObject({
      ok: false,
      error: 'workflow_script_meta_literal_required',
    });
  });

  it('rejects dangerous APIs and nondeterministic sources before execution', () => {
    for (const expression of [
      "require('fs')",
      "import('node:fs')",
      'fs.readFileSync("/tmp/x")',
      "fetch('https://example.com')",
      'new WebSocket("ws://localhost")',
      'Date.now()',
      'Math.random()',
      'new Date()',
      'process.env.OPENAI_API_KEY',
      "eval('1 + 1')",
      "Function('return 1')",
      "agent.constructor.constructor('return process')()",
      'globalThis.process',
      "child_process.spawn('echo')",
    ]) {
      expect(validateWorkflowScript(`export const meta = { name: 'unsafe_demo', description: 'desc' }\n${expression}\nawait agent('x')`)).toMatchObject({
        ok: false,
        error: 'workflow_script_forbidden_api',
      });
    }
  });

  it('requires at least one agent call and enforces static fan-out policy', () => {
    expect(validateWorkflowScript("export const meta = { name: 'static_demo', description: 'desc' }\nphase('Only phase')\nreturn { ok: true }")).toMatchObject({
      ok: false,
      error: 'workflow_script_agent_required',
    });

    expect(validateWorkflowScript(validScript, { policy: { maxAgentCalls: 2 } })).toMatchObject({
      ok: false,
      error: 'workflow_script_agent_limit_exceeded',
      actual: 4,
    });
  });

  it('rejects parallel calls that eagerly start agent promises instead of thunks', () => {
    expect(validateWorkflowScript(`export const meta = { name: 'bad_parallel', description: 'desc' }
phase('复核')
await parallel([
  agent('事实复核', { label: '事实复核' }),
  () => agent('证据复核', { label: '证据复核' }),
])`)).toMatchObject({
      ok: false,
      error: 'workflow_script_parallel_thunk_required',
    });
  });

  it('records resumable workflow metadata and rejects resumable scripts with loops', () => {
    const resumable = `export const meta = { name: 'resume_demo', description: 'resume demo', resumable: true }
phase('扫描')
await agent('扫描项目', { label: '扫描' })`;

    const result = validateWorkflowScript(resumable);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.normalized.analysis).toMatchObject({
      resumable: true,
      hasLoop: false,
    });

    expect(validateWorkflowScript(`export const meta = { name: 'loop_resume', description: 'loop resume', resumable: true }
for (const item of [1, 2]) {
  await agent('扫描 ' + item)
}`)).toMatchObject({
      ok: false,
      error: 'workflow_script_resumable_loop_forbidden',
      message: 'resumable script must not contain loops',
    });
  });

  it('parses workflow pattern metadata and analyzes role/trust/stableKey agent options', () => {
    const script = `export const meta = {
  name: 'quarantine_triage_demo',
  description: '隔离分拣外部工单',
  resumable: true,
  pattern: 'quarantine_triage',
  outputKind: 'triage_actions',
  riskClass: 'artifact_write',
}
phase('隔离')
const raw = await agent('读取外部工单', { label: '读取工单', role: 'collector', trustLevel: 'untrusted', sourceRefs: ['ticket:1'], stableKey: 'ticket-1' })
const evidence = await agent('归一化为证据', { label: '归一化', role: 'sanitizer', trustLevel: 'sanitized', inputRefs: ['raw.output'], stableKey: 'ticket-1-sanitized' })
return await agent('生成行动建议', { label: '行动建议', role: 'actor', trustLevel: 'trusted', inputRefs: ['evidence.output'], permissions: { allowWrite: true }, stableKey: 'ticket-1-action' })`;

    const result = validateWorkflowScript(script);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.normalized.meta).toMatchObject({
      pattern: 'quarantine_triage',
      outputKind: 'triage_actions',
      riskClass: 'artifact_write',
    });
    expect(result.normalized.analysis.agentOptionRoles).toEqual(['collector', 'sanitizer', 'actor']);
    expect(result.normalized.analysis.agentOptionTrustLevels).toEqual(['untrusted', 'sanitized', 'trusted']);
    expect(result.normalized.analysis.stableKeyCount).toBe(3);
    expect(result.normalized.analysis.agentInputRefCount).toBe(2);
    expect(result.normalized.analysis.agentSourceRefCount).toBe(1);
  });

  it('accepts controlled workflow.loopUntil in resumable scripts while rejecting nested loopUntil', () => {
    const loopScript = `export const meta = { name: 'loop_until_demo', description: '持续处理队列', resumable: true, pattern: 'bounded_loop_until_done' }
await workflow.loopUntil({
  label: '处理待办直到为空',
  maxIterations: 3,
  dryRunStreakToStop: 1,
  iteration: async ({ iteration }) => {
    return await agent('处理第 ' + iteration + ' 批待办', { label: '处理批次', stableKey: 'batch' })
  },
})`;

    const result = validateWorkflowScript(loopScript);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.normalized.analysis.resumable).toBe(true);
    expect(result.normalized.analysis.loopUntilCallCount).toBe(1);
    expect(result.normalized.analysis.hasLoop).toBe(false);

    const nested = `export const meta = { name: 'nested_loop_until', description: '嵌套循环', resumable: true, pattern: 'bounded_loop_until_done' }
await workflow.loopUntil({
  label: 'outer',
  maxIterations: 2,
  iteration: async () => workflow.loopUntil({ label: 'inner', maxIterations: 2, iteration: async () => agent('x') }),
})`;
    expect(validateWorkflowScript(nested)).toMatchObject({
      ok: false,
      error: 'workflow_script_nested_loop_until_forbidden',
    });
  });

  it('rejects invalid workflow pattern metadata', () => {
    expect(validateWorkflowScript(`export const meta = { name: 'bad_pattern', description: 'bad', pattern: 'freeform_graph' }
await agent('x')`)).toMatchObject({
      ok: false,
      error: 'workflow_script_meta_pattern_invalid',
    });
    expect(validateWorkflowScript(`export const meta = { name: 'bad_kind', description: 'bad', outputKind: 'freeform' }
await agent('x')`)).toMatchObject({
      ok: false,
      error: 'workflow_script_meta_output_kind_invalid',
    });
    expect(validateWorkflowScript(`export const meta = { name: 'bad_risk', description: 'bad', riskClass: 'root' }
await agent('x')`)).toMatchObject({
      ok: false,
      error: 'workflow_script_meta_risk_class_invalid',
    });
  });

  it('preserves validation policy for budget and evidence gate in previews', () => {
    const preview = createWorkflowScriptPreview(validScript, {
      projectId: 'proj-script',
      policy: {
        budget: { maxTokens: 1000, defaultEstimateMultiplier: 2 },
        evidenceGate: {
          maxRetry: 2,
          retryPolicy: 'refetch',
          checks: [{ kind: 'output_schema', requiredKeys: ['summary'] }],
        },
      },
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.policy).toMatchObject({
      budget: { maxTokens: 1000, defaultEstimateMultiplier: 2 },
      evidenceGate: { maxRetry: 2, retryPolicy: 'refetch' },
    });
  });
});

// SHARED VECTORS — keep identical with
// kswarm/test/workflow-script-source.test.js (R1: dual-impl hash consistency).
const SHARED_VECTORS = [
  {
    label: 'plain script',
    input: 'export const meta = { name: "demo" };\nphase("scan");',
    normalized: 'export const meta = { name: "demo" };\nphase("scan");',
  },
  {
    label: 'leading/trailing whitespace trimmed',
    input: '\n\n  export const meta = { name: "demo" };  \n\n',
    normalized: 'export const meta = { name: "demo" };',
  },
  {
    label: 'js fenced block stripped',
    input: '```js\nexport const meta = { name: "demo" };\nphase("scan");\n```',
    normalized: 'export const meta = { name: "demo" };\nphase("scan");',
  },
  {
    label: 'javascript fenced block stripped',
    input: '```javascript\nexport const meta = { name: "demo" };\n```',
    normalized: 'export const meta = { name: "demo" };',
  },
  {
    label: 'bare fenced block stripped',
    input: '```\nexport const meta = { name: "demo" };\n```',
    normalized: 'export const meta = { name: "demo" };',
  },
];

describe('workflow script source hashing (R1 shared vectors)', () => {
  it('normalizes shared vectors identically to the kswarm pure-node impl', () => {
    for (const vector of SHARED_VECTORS) {
      expect(normalizeWorkflowScript(vector.input), vector.label).toBe(vector.normalized);
    }
  });

  it('hashes normalized source as plain sha256 for every shared vector', () => {
    for (const vector of SHARED_VECTORS) {
      const expected = createHash('sha256').update(vector.normalized).digest('hex');
      expect(hashWorkflowScript(vector.normalized), vector.label).toBe(expected);
    }
  });

  it('produces identical hashes for fenced and unfenced equivalents', () => {
    const fenced = '```js\nexport const meta = { name: "demo" };\nphase("scan");\n```';
    const unfenced = 'export const meta = { name: "demo" };\nphase("scan");';
    expect(hashWorkflowScript(normalizeWorkflowScript(fenced)))
      .toBe(hashWorkflowScript(normalizeWorkflowScript(unfenced)));
  });
});
