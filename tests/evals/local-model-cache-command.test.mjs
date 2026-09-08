import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { terminateOwnedProcess } from '../../scripts/evals/local-model-cache/capture.mjs';
const exec = promisify(execFile); const entry = resolve('scripts/evals/local-model-cache/run.mjs');

test('command help and invalid/unknown arguments have stable, non-secret output', async () => {
  const { stdout } = await exec(process.execPath, [entry, '--help']); assert(stdout.includes('measure-print'));
  await assert.rejects(exec(process.execPath, [entry, 'observe', '--unexpected', 'SECRET']), e => !e.stderr.includes('SECRET') && e.code !== 0);
});

test('observe refuses overwriting an existing evidence file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cache-command-')); t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const out = join(root, 'evidence.jsonl'); await writeFile(out, 'KEEP');
  await assert.rejects(exec(process.execPath, [entry, 'observe', '--upstream', 'http://127.0.0.1:9', '--out', out]), e => e.stderr.includes('output_exists'));
  assert.equal(await readFile(out, 'utf8'), 'KEEP');
});

test('Windows termination handles taskkill error and never reports tree cleanup confirmed', async () => {
  let killed = false;
  const result = await terminateOwnedProcess({ pid: 123, kill() { killed = true; } }, { platform: 'win32', spawnProcess(command, args) {
    assert.equal(command, 'taskkill.exe'); assert.deepEqual(args, ['/PID', '123', '/T', '/F']);
    const proc = new EventEmitter(); queueMicrotask(() => proc.emit('error', new Error('fixture'))); return proc;
  } });
  assert.equal(result, false); assert(killed);
});

test('POSIX cleanup targets only the owned negative group PID', async () => {
  const calls = []; assert.equal(await terminateOwnedProcess({ pid: 4321 }, { platform: 'darwin', kill: (...args) => calls.push(args) }), true);
  assert.deepEqual(calls, [[-4321, 'SIGKILL']]);
});
