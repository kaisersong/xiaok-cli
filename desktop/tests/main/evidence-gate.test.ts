import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { verifyEvidenceChecks } from '../../electron/evidence-gate.js';

function makeWorkspace(label: string): string {
  return mkdtempSync(join(tmpdir(), `xiaok-evidence-${label}-`));
}

describe('evidence gate', () => {
  it('verifies schema and returns output_size as a warning only', async () => {
    const verdict = await verifyEvidenceChecks({
      runId: 'run-1',
      nodeId: 'node-run-1-1',
      result: '{"summary":"ok"}',
      workspaceRoot: makeWorkspace('schema'),
      checks: [
        { kind: 'output_schema', requiredKeys: ['summary'] },
        { kind: 'output_size', minChars: 100 },
      ],
    });

    expect(verdict).toEqual({
      ok: true,
      failures: [],
      warnings: ['output_size below minimum: 16 < 100'],
    });
  });

  it('keeps artifact_exists inside workspace and rejects symlinks', async () => {
    const workspace = makeWorkspace('artifact');
    const outside = makeWorkspace('outside');
    try {
      mkdirSync(join(workspace, 'artifacts'));
      writeFileSync(join(workspace, 'artifacts', 'report.md'), '# report\n');
      writeFileSync(join(outside, 'secret.md'), '# secret\n');

      // Creating symlinks on Windows requires elevated privileges (or Developer
      // Mode); skip the symlink-specific assertion when it is not permitted so
      // the cross-platform artifact checks still run.
      let symlinkCreated = false;
      try {
        symlinkSync(join(outside, 'secret.md'), join(workspace, 'artifacts', 'secret-link.md'));
        symlinkCreated = true;
      } catch (err) {
        if (process.platform !== 'win32') throw err;
      }

      await expect(verifyEvidenceChecks({
        runId: 'run-1',
        nodeId: 'node-run-1-1',
        result: {},
        workspaceRoot: workspace,
        checks: [{ kind: 'artifact_exists', path: 'artifacts/report.md' }],
      })).resolves.toMatchObject({ ok: true, failures: [] });

      await expect(verifyEvidenceChecks({
        runId: 'run-1',
        nodeId: 'node-run-1-1',
        result: {},
        workspaceRoot: workspace,
        checks: [{ kind: 'artifact_exists', path: '../secret.md' }],
      })).resolves.toMatchObject({ ok: false, failures: ['artifact_exists path outside workspace'] });

      if (symlinkCreated) {
        await expect(verifyEvidenceChecks({
          runId: 'run-1',
          nodeId: 'node-run-1-1',
          result: {},
          workspaceRoot: workspace,
          checks: [{ kind: 'artifact_exists', path: 'artifacts/secret-link.md' }],
        })).resolves.toMatchObject({ ok: false, failures: ['artifact_exists symlink rejected'] });
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('runs exact-match test_command through spawn and rejects additional args', async () => {
    const workspace = makeWorkspace('command');
    try {
      writeFileSync(join(workspace, 'package.json'), JSON.stringify({
        scripts: {
          test: 'node -e "process.exit(0)"',
        },
      }));

      await expect(verifyEvidenceChecks({
        runId: 'run-1',
        nodeId: 'node-run-1-1',
        result: {},
        workspaceRoot: workspace,
        checks: [{ kind: 'test_command', command: 'npm test', expectExitCode: 0 }],
      })).resolves.toMatchObject({ ok: true, failures: [] });

      await expect(verifyEvidenceChecks({
        runId: 'run-1',
        nodeId: 'node-run-1-1',
        result: {},
        workspaceRoot: workspace,
        checks: [{ kind: 'test_command', command: 'npm test -- --watch', expectExitCode: 0 }],
      })).resolves.toMatchObject({
        ok: false,
        failures: ['test_command not allowed: npm test -- --watch'],
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
