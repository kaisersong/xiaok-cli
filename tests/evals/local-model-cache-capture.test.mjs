import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { capturePrint } from '../../scripts/evals/local-model-cache/capture.mjs';

const event = (delta, reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('real print CLI: hidden thinking and streamed body remain invisible until actual stdout flush', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cache-print-test-')); const work = join(root, 'work'); await mkdir(work);
  const thinking = deferred(); const content = deferred(); const releaseContent = deferred(); const releaseEnd = deferred();
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* drain real production request */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event({ reasoning_content: 'HIDDEN_FIXTURE_REASONING' })); thinking.resolve();
    await releaseContent.promise;
    res.write(event({ content: 'VISIBLE_PRINT_MARKER' })); content.resolve();
    await releaseEnd.promise;
    res.end(event({}, 'stop') + 'data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(async () => { releaseContent.resolve(); releaseEnd.resolve(); upstream.closeAllConnections(); await new Promise(r => upstream.close(r)); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const seen = [];
  const result = capturePrint({ cliEntry: resolve('dist/index.js'), cwd: work, upstream: `http://127.0.0.1:${upstream.address().port}`, model: 'gpt-cache-fixture', prompt: 'Respond with the fixture answer.', onOutput: b => seen.push(b.toString()) });
  await thinking.promise; await new Promise(r => setTimeout(r, 70)); assert.deepEqual(seen, []);
  releaseContent.resolve(); await content.promise; await new Promise(r => setTimeout(r, 70)); assert.deepEqual(seen, []);
  releaseEnd.resolve(); const record = await result;
  assert.equal(record.status, 'success'); assert.equal(record.outputVerified, true);
  assert(record.visibleMs > record.requests[0].sse.firstContentMs);
  assert(record.requests[0].sse.firstContentMs > record.requests[0].sse.firstThinkingMs);
  assert.equal(seen.join('').trim(), 'VISIBLE_PRINT_MARKER');
  assert(!JSON.stringify(record).includes('VISIBLE_PRINT_MARKER')); assert(!JSON.stringify(record).includes('HIDDEN_FIXTURE_REASONING'));
});

test('real print CLI: fragmented tool arguments do not execute before completion and are not visible text', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cache-tool-test-')); await writeFile(join(root, 'fixture.txt'), 'READ_FIXTURE_OK');
  const partial = deferred(); const release = deferred(); let calls = 0; let toolSucceeded = false;
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); const input = JSON.parse(Buffer.concat(chunks));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (calls++ === 0) {
      res.write(event({ tool_calls: [{ index: 0, id: 'read_fixture', type: 'function', function: { name: 'read', arguments: '{"file_path":' } }] })); partial.resolve();
      await release.promise;
      res.write(event({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(join(root, 'fixture.txt')) + '}' } }] }));
      res.end(event({}, 'tool_calls') + 'data: [DONE]\n\n');
    } else {
      toolSucceeded = input.messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes('READ_FIXTURE_OK'));
      res.end(event({ content: 'READ_VERIFIED' }, 'stop') + 'data: [DONE]\n\n');
    }
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(async () => { release.resolve(); upstream.closeAllConnections(); await new Promise(r => upstream.close(r)); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const seen = []; const result = capturePrint({ cliEntry: resolve('dist/index.js'), cwd: root, upstream: `http://127.0.0.1:${upstream.address().port}`, model: 'gpt-cache-fixture', prompt: 'Read fixture.txt then answer.', onOutput: b => seen.push(b.toString()) });
  await partial.promise; await new Promise(r => setTimeout(r, 70)); assert.equal(calls, 1); assert.deepEqual(seen, []);
  release.resolve(); const record = await result;
  assert(toolSucceeded); assert.equal(record.status, 'success'); assert.equal(record.requests.length, 2);
  assert(record.requests[0].sse.firstCompleteToolMs > record.requests[0].sse.firstEffectiveDeltaMs);
  assert.equal(record.requests[0].sse.firstContentMs, null); assert(record.visibleMs > record.requests[0].sse.firstCompleteToolMs);
});

test('real child with no output becomes timeout, not zero-latency success', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cache-empty-test-'));
  // Actual process boundary, not an in-process Promise stub.
  const entry = join(root, 'entry.mjs'); await writeFile(entry, 'setInterval(() => {}, 1000);');
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const r = await capturePrint({ cliEntry: entry, cwd: root, upstream: 'http://127.0.0.1:9', model: 'fixture', prompt: 'fixture', totalMs: 150 });
  assert.equal(r.status, 'timeout'); assert.equal(r.visibleMs, null); assert.equal(r.outputVerified, false);
});

test('AbortSignal terminates the actual owned parent and grandchild before cleanup is reported', { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cache-tree-test-')); const entry = join(root, 'entry.mjs');
  await writeFile(entry, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {stdio:'ignore'});
writeFileSync('owned-pid.txt', String(child.pid));
process.stdout.write('STARTED'); setInterval(()=>{},1000);`);
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const controller = new AbortController();
  const r = await capturePrint({ cliEntry: entry, cwd: root, upstream: 'http://127.0.0.1:9', model: 'fixture', prompt: 'fixture', signal: controller.signal, onOutput() { controller.abort(); } });
  assert.equal(r.status, 'cancelled'); assert.equal(r.terminationConfirmed, true);
  const pid = Number(await readFile(join(root, 'owned-pid.txt'), 'utf8'));
  let gone = false;
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') { gone = true; break; } throw e; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert(gone, 'owned grandchild must be physically gone');
});
