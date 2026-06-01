import { describe, expect, it } from 'vitest';

import {
  createWorkflowScriptPreview,
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
});
