import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { createObserver } from './observer.mjs';
import { analyzeWindow } from './metrics.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Windows uses the real executable; errors are handled and never claim tree cleanup. */
export function terminateOwnedProcess(child, { platform = process.platform, spawnProcess = spawn, kill = process.kill.bind(process) } = {}) {
  if (!child.pid) return Promise.resolve(false);
  if (platform !== 'win32') {
    try { kill(-child.pid, 'SIGKILL'); return Promise.resolve(true); } catch (e) { return Promise.resolve(e.code === 'ESRCH'); }
  }
  return new Promise(resolvePromise => {
    const taskkill = spawnProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    taskkill.once('error', () => { child.kill(); resolvePromise(false); });
    taskkill.once('close', code => { if (code !== 0) child.kill(); resolvePromise(code === 0); });
  });
}

export async function capturePrint({ cliEntry, cwd, upstream, model, prompt, totalMs = 180_000, onOutput = () => {}, signal } = {}) {
  if (!Number.isSafeInteger(totalMs) || totalMs <= 0 || totalMs > 3_600_000 || !model || typeof prompt !== 'string' || !prompt.trim()) throw new Error('invalid_capture_arguments');
  const entry = resolve(cliEntry); const root = await mkdtemp(join(tmpdir(), 'xiaok-cache-capture-'));
  const requests = []; const hashes = {};
  for (const [name, path] of Object.entries({ entry, openai: join(dirname(entry), 'ai', 'adapters', 'openai.js'), runtime: join(dirname(entry), 'ai', 'runtime', 'agent-runtime.js'), chat: join(dirname(entry), 'commands', 'chat.js') })) {
    hashes[name] = await readFile(path).then(sha, () => null);
  }
  let firstRequest = null; let firstOutput = null; let stdoutBytes = 0; let stderrBytes = 0;
  let expected = ''; let output = ''; let oversized = false; const decoder = new StringDecoder('utf8');
  const proxy = await createObserver({ upstream, scope: null, onRecord: r => requests.push(r),
    onStart: ({ startedAtMonotonicMs }) => { firstRequest ??= startedAtMonotonicMs; },
    onContent: ({ delta }) => { if (!oversized) expected += delta; if (Buffer.byteLength(expected) > 8 * 1024 * 1024) { expected = ''; oversized = true; } },
  }).catch(async error => { await rm(root, { recursive: true, force: true, maxRetries: 3 }); throw error; });
  // A dedicated configuration avoids modifying the user's credentials, provider or MCP setup.
  // This is a diagnostic configuration; it does not claim to reproduce the user's complete tool population.
  const config = { schemaVersion: 1, defaultModel: 'custom', models: { custom: { baseUrl: `${proxy.origin}/v1`, apiKey: 'local-measurement', model } }, defaultMode: 'interactive', contextBudget: 8_000, channels: {} };
  let timer; let child; let stopReason = null; let termination = Promise.resolve(true); let start;
  const abort = () => { stopReason ??= 'cancelled'; if (child) termination = terminateOwnedProcess(child); };
  try {
    await writeFile(join(root, 'config.json'), JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    start = performance.now();
    child = spawn(process.execPath, [entry, 'chat', '-p', prompt], { cwd: resolve(cwd), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', XIAOK_CONFIG_DIR: root, XIAOK_DISABLE_GLOBAL_PLUGINS: '1', XIAOK_TURN_TIMEOUT_MS: String(totalMs), NO_COLOR: '1' } });
    const completion = new Promise(resolvePromise => {
      child.on('error', () => { stopReason ??= 'spawn_error'; });
      child.on('close', (code, signal) => resolvePromise({ code, signal, closedAt: performance.now() }));
    });
    child.stdout.on('data', bytes => {
      stdoutBytes += bytes.length; const text = decoder.write(bytes);
      if (text.trim()) firstOutput ??= performance.now();
      if (!oversized) output += text;
      if (stdoutBytes > 8 * 1024 * 1024) { output = ''; oversized = true; }
      try { onOutput(bytes); } catch { stopReason ??= 'output_callback_error'; termination = terminateOwnedProcess(child); }
    });
    child.stderr.on('data', bytes => { stderrBytes += bytes.length; });
    timer = setTimeout(() => { stopReason ??= 'timeout'; termination = terminateOwnedProcess(child); }, totalMs);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const closed = await completion; clearTimeout(timer); const terminated = await termination;
    await proxy.close();
    const outputVerified = !oversized && output.trim().length > 0 && output.trim() === expected.trim()
      && firstRequest !== null && firstOutput >= firstRequest && requests.length > 0
      && requests.every(r => r.status === 'complete' && r.sse.available && r.bodyEquivalent === true && r.methodPathEquivalent && r.sensitiveHeadersEquivalent);
    return { version: 1, mode: 'print', configuration: 'isolated-local-diagnostic', keyId: proxy.keyId,
      cliHashes: hashes, inputDigest: proxy.privateDigest(prompt), modelDigest: proxy.privateDigest(model), totalLimitMs: totalMs,
      status: stopReason ?? (proxy.error ? 'record_error' : closed.code !== 0 ? 'cli_error' : !outputVerified ? 'output_unverified' : 'success'),
      exitCode: closed.code, exitSignal: closed.signal, terminationConfirmed: terminated, outputVerified,
      firstRequestDelayMs: firstRequest === null ? null : firstRequest - start,
      visibleMs: outputVerified ? firstOutput - firstRequest : null,
      stdoutFirstFlushMs: firstOutput === null ? null : firstOutput - start,
      totalMs: closed.closedAt - start, taskFromFirstRequestMs: firstRequest === null ? null : closed.closedAt - firstRequest,
      stdoutBytes, stderrBytes, requests, window: analyzeWindow(requests),
      decision: 'inconclusive', calibration: 'stdout_pipe_receipt_is_flush_upper_bound_not_tui_or_calibrated_roi' };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); await proxy.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}
