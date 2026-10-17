// @vitest-environment node
// Existing CLI/common-writer behavior characterization, not global permission qualification.
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { fixture, TARGET } from '../support/diagnostics-input-fixture.js';
import { runTraceExportCommand } from '../../../src/commands/trace-export.js';
it('SIBLING_CLI project/session/input-copy all use their real production routes; Main input guard is not shared-writer authority', async () => {
  const f = await fixture(), projectDetailPath = join(f.root, 'owned-project-detail.json'); writeFileSync(projectDetailPath, JSON.stringify(f.detail));
  const output = await runTraceExportCommand({ projectId: 'project-1', projectDetailPath, outputPath: join(f.root, 'cli-project.json') });
  expect(JSON.parse(readFileSync(output, 'utf8')).scope).toMatchObject({ kind: 'project', projectId: 'project-1' });
  await f.seedSnapshot();
  const session = await runTraceExportCommand({ sessionId: 'session-1', dataRoot: f.data, outputPath: join(f.root, 'cli-session.json') });
  expect(JSON.parse(readFileSync(session, 'utf8')).scope).toMatchObject({ kind: 'session', sessionId: 'session-1' });
  const copied = await runTraceExportCommand({ inputPath: output, outputPath: join(f.root, 'cli-copy.json') }); expect(readFileSync(copied, 'utf8')).toBe(readFileSync(output, 'utf8'));
  const main = await f.preload.exportTraceBundle(TARGET); expect(main.ok).toBe(true); expect(JSON.parse(readFileSync(main.path!, 'utf8')).scope).toMatchObject({ kind: 'project', projectId: 'project-1' });
});
it('SIBLING_CLI missing-session failure and existing output force policy remain original', async () => {
  const f = await fixture(), path = join(f.root, 'cli-owned.json'); writeFileSync(path, 'OWNED_PREEXISTING');
  await expect(runTraceExportCommand({ sessionId: 'missing', dataRoot: f.data, outputPath: path })).rejects.toThrow('no snapshots found for session: missing');
  expect(readFileSync(path, 'utf8')).toBe('OWNED_PREEXISTING');
  const exported = await f.preload.exportTraceBundle(TARGET);
  await expect(runTraceExportCommand({ inputPath: exported.path!, outputPath: path })).rejects.toThrow('output already exists: ' + path);
  const copied = await runTraceExportCommand({ inputPath: exported.path!, outputPath: path, force: true }); expect(readFileSync(copied, 'utf8')).toBe(readFileSync(exported.path!, 'utf8'));
});
