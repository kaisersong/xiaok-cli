import { test } from 'node:test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory as scanInventory, writeReport } from '../../scripts/evals/sol-pi/inventory.mjs';

async function scopeFor(f) {
  return { schemaVersion: 1, purpose: 'sol-pi-p0a-local-metadata',
    cli: (await readdir(f.cliDir)).filter(n => n.endsWith('.json')),
    desktop: (await readdir(f.desktopDir)).filter(n => n.endsWith('.json')) };
}
async function inventory(f) {
  let authorization;
  try { authorization = await scopeFor(f); }
  catch { authorization = { schemaVersion: 1, purpose: 'sol-pi-p0a-local-metadata', cli: [], desktop: [] }; }
  return scanInventory({ ...f, authorization });
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sol-pi-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cliDir = join(root, 'cli'); const desktopDir = join(root, 'desktop');
  await mkdir(cliDir); await mkdir(desktopDir);
  return { root, cliDir, desktopDir };
}
const session = (id, content = 'hello') => ({ schemaVersion: 1, sessionId: id,
  messages: [{ role: 'user', content: [{ type: 'tool_result', content, is_error: false }] }],
  usage: { inputTokens: 12, outputTokens: 3 } });
const save = (dir, name, data) => writeFile(join(dir, name), JSON.stringify(data));

test('real saved schemas produce metadata only; no gate is inferred from task status', async t => {
  const f = await fixture(t); const secret = 'PRIVATE-TEXT-MUST-NOT-LEAVE-INPUT';
  const data = session('private-session', '中文');
  data.messages.push({ role: 'assistant', content: [{ type: 'thinking', thinking: secret }] });
  data.cwd = secret; data.model = secret;
  await save(f.cliDir, 'private-session.json', data);
  await save(f.desktopDir, 'private-task.json', { taskId: 'private-task', sessionId: 'parent', status: 'completed',
    prompt: secret, events: [{ type: 'canvas_tool_result', response: secret, ok: false },
      { type: 'usage_recorded', inputTokens: 8, outputTokens: 2 }], usage: { known: true, inputTokens: 8, outputTokens: 2 } });
  const report = await inventory(f);
  assert.equal(report.surfaces.cli.records, 1);
  assert.equal(report.surfaces.cli.output.totalBytes, 6);
  assert.equal(report.surfaces.desktop.output.errorResults, 1);
  assert.equal(report.surfaces.desktop.usage.numericRecords, 1);
  assert.equal(report.admission, 'inconclusive');
  assert.deepEqual(report.approvedCandidates, []);
  assert.equal(report.independentTaskCount, null);
  assert.equal(report.surfaces.managedChild.coverage, 'not_measured');
  for (const value of [secret, 'private-session', 'private-task', 'private-name', f.root]) {
    assert.equal(JSON.stringify(report).includes(value), false);
  }
  assert.deepEqual(await inventory(f), report);
});

test('counts stored result entries, UTF8 bytes and nearest-rank P95 without claiming full output', async t => {
  const f = await fixture(t); const data = session('one');
  data.messages[0].content = Array.from({ length: 20 }, (_, i) => ({
    type: 'tool_result', content: 'a'.repeat(i + 1), is_error: i === 0,
  }));
  data.messages[0].content.push({ type: 'tool_result', content: [{ text: 'not flattened' }] });
  await save(f.cliDir, 'one.json', data);
  const r = (await inventory(f)).surfaces.cli;
  assert.equal(r.output.textResults, 20); assert.equal(r.output.unknownResults, 1);
  assert.equal(r.output.totalBytes, 210); assert.equal(r.output.p95Bytes, 19);
  assert.equal(r.output.maxBytes, 20); assert.equal(r.output.errorResults, 1);
  assert.equal(r.output.preTruncationCompleteness, 'unknown');
});

test('unknown usage never becomes measured zero; cap comparison uses UTF16 units', async t => {
  const f = await fixture(t);
  const a = session('a', '中'.repeat(50_001)); a.usage.inputTokens = -1;
  await save(f.cliDir, 'a.json', a);
  await save(f.desktopDir, 'b.json', { taskId: 'b', events: [], usage: { known: false, inputTokens: 100, outputTokens: 2 } });
  const r = await inventory(f);
  assert.equal(r.surfaces.cli.usage.numericRecords, 0);
  assert.equal(r.surfaces.cli.usage.inputP95, null);
  assert.equal(r.surfaces.desktop.usage.inputP95, null);
  assert.equal(r.surfaces.cli.output.checkpointEntriesOver50000Units, 1);
});

test('filename identity mismatches never contaminate records', async t => {
  const f = await fixture(t);
  await save(f.cliDir, 'wrong.json', session('same'));
  await save(f.cliDir, 'same.json', session('same'));
  const r = await inventory(f);
  assert.equal(r.surfaces.cli.records, 1); assert.equal(r.files.identityMismatch, 1);
});

test('bad, oversized, wrong-schema and symlink inputs remain visible as exclusions', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cliDir, 'bad.json'), '{private broken text');
  await writeFile(join(f.cliDir, 'large.json'), 'x'.repeat(17 * 1024 * 1024));
  await save(f.cliDir, 'wrong.json', { messages: [] });
  await symlink(join(f.cliDir, 'bad.json'), join(f.cliDir, 'link.json'));
  await mkdir(join(f.cliDir, 'nested'));
  await save(join(f.cliDir, 'nested'), 'hidden.json', session('nested'));
  const r = await inventory(f);
  assert.equal(r.files.discovered, 4); assert.equal(r.files.invalidJson, 1);
  assert.equal(r.files.tooLarge, 1); assert.equal(r.files.invalidSchema, 1);
  assert.equal(r.files.symlinks, 1); assert.equal(r.surfaces.cli.records, 0);
  assert.equal(JSON.stringify(r).includes('private broken text'), false);
});

test('input directories must exist, be distinct and must not be symlinks', async t => {
  const f = await fixture(t);
  await assert.rejects(inventory({ ...f, cliDir: join(f.root, 'absent') }), /input_directory/);
  await assert.rejects(inventory({ ...f, desktopDir: f.cliDir }), /input_directory_overlap/);
  const link = join(f.root, 'alias'); await symlink(f.cliDir, link);
  await assert.rejects(inventory({ ...f, cliDir: link }), /input_directory/);
});

test('report writing rejects input trees, existing files and aliases into input', async t => {
  const f = await fixture(t); const report = await inventory(f);
  await assert.rejects(writeReport({ ...f, report, output: join(f.cliDir, 'report.json') }), /output_inside_input/);
  const alias = join(f.root, 'alias'); await symlink(f.desktopDir, alias);
  await assert.rejects(writeReport({ ...f, report, output: join(alias, 'report.json') }), /output_inside_input/);
  const output = join(f.root, 'report.json');
  await writeReport({ ...f, report, output });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), report);
  await assert.rejects(writeReport({ ...f, report, output }), /EEXIST/);
});

test('CLI executes the actual module and rejects missing or unknown arguments without leaking values', async t => {
  const f = await fixture(t); const entry = resolve('scripts/evals/sol-pi/inventory.mjs');
  await save(f.cliDir, 'one.json', session('one'));
  const output = join(f.root, 'report.json');
  const manifest = join(f.root, 'scope.json'); await writeFile(manifest, JSON.stringify(await scopeFor(f)));
  const good = spawnSync(process.execPath, [entry, '--cli-dir', f.cliDir, '--desktop-dir', f.desktopDir, '--out', output, '--scope-manifest', manifest], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).surfaces.cli.records, 1);
  const bad = spawnSync(process.execPath, [entry, '--secret', 'PRIVATE'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0); assert.equal((bad.stderr + bad.stdout).includes('PRIVATE'), false);
});


test('excluded private fields have no content fingerprint in the report', async t => {
  const f = await fixture(t); const data = session('one');
  data.messages.push({ role: 'assistant', content: [{ type: 'thinking', thinking: 'first' }] });
  await save(f.cliDir, 'one.json', data); const before = await inventory(f);
  data.messages[1].content[0].thinking = 'completely different private reasoning with different length';
  data.prompt = 'changed prompt'; data.cwd = 'changed path';
  await save(f.cliDir, 'one.json', data);
  assert.deepEqual(await inventory(f), before);
});

test('journal-bearing checkpoints are unavailable, not stale current tasks', async t => {
  const f = await fixture(t);
  await save(f.desktopDir, 'a.json', { taskId: 'a', events: [] });
  await writeFile(join(f.desktopDir, 'a.journal.jsonl'), 'PRIVATE JOURNAL');
  const r = await inventory(f);
  assert.equal(r.files.journalPending, 1); assert.equal(r.files.journals, 1);
  assert.equal(r.surfaces.desktop.records, 0);
});

test('explicit scope limits reads and preserves excluded/missing population counts', async t => {
  const f = await fixture(t);
  await save(f.cliDir, 'a.json', session('a'));
  await writeFile(join(f.cliDir, 'unlisted.json'), 'bad json must not parse');
  const authorization = { schemaVersion: 1, purpose: 'sol-pi-p0a-local-metadata', cli: ['a.json', 'missing.json'], desktop: [] };
  const r = await scanInventory({ ...f, authorization });
  assert.equal(r.files.notAuthorized, 1); assert.equal(r.files.missing, 1);
  assert.equal(r.files.invalidJson, 0); assert.equal(r.surfaces.cli.records, 1);
  await assert.rejects(scanInventory(f), /scope_manifest/);
  await assert.rejects(scanInventory({ ...f, authorization: { ...authorization, cli: ['../a.json'] } }), /scope_manifest/);
});

test('strict UTF8, unknown schema and usage conflicts never become valid measurements', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cliDir, 'utf8.json'), Buffer.from([0xff]));
  await save(f.cliDir, 'future.json', { ...session('future'), schemaVersion: 999 });
  await save(f.cliDir, 'one.json', { ...session('one'), usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } });
  await save(f.cliDir, 'two.json', session('two'));
  await save(f.desktopDir, 'conflict.json', { taskId: 'conflict', events: [{ type: 'usage_recorded', inputTokens: 1, outputTokens: 2 }], usage: { known: true, inputTokens: 10, outputTokens: 20 } });
  const r = await inventory(f);
  assert.equal(r.files.invalidUtf8, 1); assert.equal(r.files.invalidSchema, 1);
  assert.equal(r.surfaces.cli.usage.inputMax, Number.MAX_SAFE_INTEGER);
  assert.equal('inputTokens' in r.surfaces.cli.usage, false);
  assert.equal(r.surfaces.desktop.usage.conflictingRecords, 1);
  assert.equal(r.surfaces.desktop.usage.numericRecords, 0);
});


test('all required surfaces, buckets and opportunity estimates remain explicit', async t => {
  const f = await fixture(t); const r = await inventory(f);
  assert.equal(r.taskBuckets.length, 8);
  assert.ok(r.taskBuckets.every(b => b.status === 'unavailable' && b.admission === 'inconclusive'));
  assert.equal(Object.keys(r.opportunities).length, 4);
  assert.ok(Object.values(r.opportunities).every(v => v === 'unavailable'));
  assert.equal(r.surfaces.cli.output.p95Bytes, null);
});

test('invalid entry containers and fractional token fields remain visible', async t => {
  const f = await fixture(t); const data = session('a');
  data.messages.push(null, { role: 'assistant', content: 'unsupported' });
  data.messages[0].content.push(null);
  data.usage.inputTokens = 1.5;
  await save(f.cliDir, 'a.json', data);
  const r = await inventory(f);
  assert.equal(r.surfaces.cli.malformedEntries, 3);
  assert.equal(r.surfaces.cli.usage.numericRecords, 0);
});


test('Desktop unknown usage never upgrades from events; invalid events conflict only with known totals', async t => {
  const f = await fixture(t);
  await save(f.desktopDir, 'unknown.json', { taskId: 'unknown', events: [{ type: 'usage_recorded', inputTokens: 3, outputTokens: 4 }], usage: { known: false, inputTokens: 3, outputTokens: 4 } });
  await save(f.desktopDir, 'conflict.json', { taskId: 'conflict', events: [{ type: 'usage_recorded', inputTokens: -1, outputTokens: 4 }], usage: { known: true, inputTokens: 3, outputTokens: 4 } });
  const r = await inventory(f);
  assert.equal(r.surfaces.desktop.usage.unknownRecords, 1);
  assert.equal(r.surfaces.desktop.usage.conflictingRecords, 1);
  assert.equal(r.surfaces.desktop.usage.numericRecords, 0);
});

test('report keys are a closed whitelist; no source object is spread into output', async t => {
  const f = await fixture(t); const r = await inventory(f);
  assert.deepEqual(Object.keys(r).sort(), ['schemaVersion','admission','approvedCandidates','independentTaskCount','fileCountersScope','files','surfaces','taskBuckets','opportunities'].sort());
  assert.deepEqual(Object.keys(r.surfaces.cli).sort(), ['coverage','records','messageCount','eventCount','malformedEntries','output','usage','fieldAvailability'].sort());
  assert.deepEqual(Object.keys(r.surfaces.cli.usage).sort(), ['numericRecords','unknownRecords','conflictingRecords','inputP95','inputMax','outputP95','outputMax','semantics'].sort());
});


test('presence coverage exposes cache/identity gaps without leaking values', async t => {
  const f = await fixture(t); const a = session('a');
  a.model = 'PRIVATE MODEL'; a.usage.cacheReadInputTokens = 123;
  a.usage.cacheCreationInputTokens = -1;
  a.messages[0].content[0].tool_use_id = 'PRIVATE INVOCATION';
  await save(f.cliDir, 'a.json', a);
  const r = await inventory(f); const fields = r.surfaces.cli.fieldAvailability;
  assert.equal(fields.records.model.present, 1);
  assert.equal(fields.records.cacheRead.present, 1);
  assert.equal(fields.records.cacheWrite.invalid, 1);
  assert.equal(fields.records.requestIdentity.schemaUnavailable, 1);
  assert.equal(fields.results.invocationId.present, 1);
  assert.equal(fields.results.complete.schemaUnavailable, 1);
  assert.equal(JSON.stringify(r).includes('PRIVATE'), false);
});

test('missing and symlink exclusions precede journalPending', async t => {
  const f = await fixture(t);
  await writeFile(join(f.desktopDir, 'missing.journal.jsonl'), 'not read');
  await writeFile(join(f.desktopDir, 'alias.journal.jsonl'), 'not read');
  await symlink(join(f.desktopDir, 'missing.json'), join(f.desktopDir, 'alias.json'));
  const r = await scanInventory({ ...f, authorization: { schemaVersion: 1, purpose: 'sol-pi-p0a-local-metadata', cli: [], desktop: ['missing.json', 'alias.json'] } });
  assert.equal(r.files.missing, 1); assert.equal(r.files.symlinks, 1);
  assert.equal(r.files.journalPending, 0); assert.equal(r.files.journals, 2);
});


test('a directory mutation during actual file opening invalidates the entire surface', async t => {
  const f = await fixture(t); await save(f.cliDir, 'a.json', session('a'));
  const target = await fs.realpath(join(f.cliDir, 'a.json'));
  const originalOpen = fs.open; let injected = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (!injected && args[0] === target) {
      injected = true; await save(f.cliDir, 'new.json', session('new'));
    }
    return handle;
  });
  const r = await inventory(f);
  assert.equal(injected, true);
  assert.equal(r.surfaces.cli.coverage, 'source_changed');
  assert.equal(r.surfaces.cli.records, 0); assert.equal(r.files.sourceChangedSurfaces, 1);
  assert.equal(r.files.accepted, 0);
});

test('changes to the first surface during the second surface scan invalidate the first surface', async t => {
  const f = await fixture(t); await save(f.cliDir, 'a.json', session('a'));
  await save(f.desktopDir, 'b.json', { taskId: 'b', events: [] });
  const target = await fs.realpath(join(f.desktopDir, 'b.json'));
  const originalOpen = fs.open; let injected = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (!injected && args[0] === target) {
      injected = true; await save(f.cliDir, 'late.json', session('late'));
    }
    return handle;
  });
  const r = await inventory(f);
  assert.equal(injected, true);
  assert.equal(r.surfaces.cli.coverage, 'source_changed');
  assert.equal(r.surfaces.cli.records, 0); assert.equal(r.files.sourceChangedSurfaces, 1);
  assert.equal(r.surfaces.desktop.records, 1); assert.equal(r.files.accepted, 1);
});
