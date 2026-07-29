import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCORER_PATH = join(
  process.cwd(),
  'scripts/evals/xiaok-product/scorers/project-scorer.mjs',
);

async function loadModule(): Promise<any> {
  return import(pathToFileURL(SCORER_PATH).href);
}

const task = {
  taskId: 'prod:project:t',
  category: 'project',
  expectations: { projectCreatedOnly: true },
};

function signalsWithResult(response: string, extra: Record<string, unknown> = {}): any {
  return {
    status: 'completed',
    artifacts: [],
    toolInvocations: [
      { type: 'call', toolName: 'create_project' },
      { type: 'result', toolName: 'create_project', response, ...extra },
    ],
  };
}

describe('xiaok-product project scorer (degraded: creation only)', () => {
  it('passes when create_project response parses to a project_card with projectId and no error key', async () => {
    const { scoreProject } = await loadModule();
    const outcome = scoreProject({
      task,
      signals: signalsWithResult(JSON.stringify({
        type: 'project_card',
        projectId: 'proj-123',
        status: 'planning',
      })),
    });
    expect(outcome.passed).toBe(true);
    expect(outcome.projectId).toBe('proj-123');
  });

  it('FAILS when create_project returned an error payload even though the event says ok:true (M2)', async () => {
    const { scoreProject } = await loadModule();
    const outcome = scoreProject({
      task,
      signals: signalsWithResult(
        JSON.stringify({ error: 'KSwarm service unavailable: connect ECONNREFUSED' }),
        { ok: true },
      ),
    });
    expect(outcome.passed).toBe(false);
  });

  it('fails when create_project was never called', async () => {
    const { scoreProject } = await loadModule();
    const outcome = scoreProject({
      task,
      signals: { status: 'completed', artifacts: [], toolInvocations: [] },
    });
    expect(outcome.passed).toBe(false);
  });

  it('fails on unparseable or non-card responses', async () => {
    const { scoreProject } = await loadModule();
    expect(scoreProject({ task, signals: signalsWithResult('not-json') }).passed).toBe(false);
    expect(scoreProject({
      task,
      signals: signalsWithResult(JSON.stringify({ type: 'something_else', projectId: 'p' })),
    }).passed).toBe(false);
    expect(scoreProject({
      task,
      signals: signalsWithResult(JSON.stringify({ type: 'project_card', projectId: '' })),
    }).passed).toBe(false);
  });

  it('scope guard: the scorer source contains no lifecycle-status or ok-flag judgement (B3 boundary)', async () => {
    const source = readFileSync(SCORER_PATH, 'utf8');
    expect(source.includes('in_progress')).toBe(false);
    expect(source.includes('delivered')).toBe(false);
    expect(source.includes('.ok')).toBe(false);
  });
});
