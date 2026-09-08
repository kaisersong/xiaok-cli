import { mkdtemp, realpath, access, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SessionProbe, resolveLaunch } from './session-probe.mjs';

if (!process.argv.includes('--live')) {
  console.log('Explicit opt-in required: node scripts/evals/codex-native-session/run.mjs --live [--codex real-entry] [--output report.json]');
  process.exit(0);
}
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
let executable = option('--codex');
if (!executable) for (const dir of (process.env.PATH || '').split(delimiter)) {
  try { executable = await realpath(join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex')); break; } catch {}
}
if (!executable) throw new Error('Codex not found; specify --codex with a real JS or executable entry');
executable = await realpath(executable);
const versionLaunch = resolveLaunch(executable, ['--version']);
const version = execFileSync(versionLaunch.command, versionLaunch.args, { encoding: 'utf8' }).trim();
const cwd = await mkdtemp(join(tmpdir(), 'xiaok-native-validation-'));
const output = resolve(option('--output') || join(cwd, 'report.json'));
const options = { executable, prefixArgs: ['app-server', '--stdio', '-c', 'features.hooks=false'], cwd, timeoutMs: 120000 };
const report = { at: new Date().toISOString(), version, cwd, scope: 'standalone validation, approvals always denied', gates: {}, processes: [] };
let probe;
const log = (gate, details) => { report.gates[gate] = details; console.log(JSON.stringify({ gate, ...details })); };
async function fresh() { probe = new SessionProbe(options); await probe.connect(); report.processes.push(probe.pid); }
async function finish(turnId, after) {
  const event = await probe.waitFor('turn/completed', e => e.params.threadId === probe.threadId && e.params.turn.id === turnId, { after });
  if (event.params.turn.status !== 'completed') throw new Error(`turn terminal status: ${event.params.turn.status}`);
  return probe.events.filter(e => e.seq > after && e.method === 'item/completed' && e.params.threadId === probe.threadId && e.params.turnId === turnId && e.params.item?.type === 'agentMessage').map(e => e.params.item.text).join('\n');
}
async function gate(name, fn) {
  const after = probe.cursor;
  try { await fn(); } catch (error) {
    const counts = {};
    for (const e of probe.events.filter(e => e.seq > after)) counts[e.method] = (counts[e.method] || 0) + 1;
    log(name, { ...report.gates[name], status: 'failed', error: error.message, eventCounts: counts });
    // Each remaining gate must start from a known idle client, even after failure.
    if (probe.activeTurnId) {
      try { await probe.interrupt(); } catch { await probe.close(); await fresh(); await probe.create(); }
    }
  }
}
try {
  await fresh();
  const created = await probe.create(); report.threadId = probe.threadId; report.model = created.model;
  const nonce = randomUUID();
  await gate('create', async () => {
    const after = probe.cursor;
    const { turnId } = await probe.start(`[xiaok-native-session-validation] This is an isolated protocol test. Do not use any tools. Remember the token ${nonce} for the next message. Reply with only that token.`);
    const answer = await finish(turnId, after);
    log('create', { status: answer.includes(nonce) ? 'passed' : 'failed', turnId, tokenMatched: answer.includes(nonce) });
  });
  await probe.close(); report.firstProcessExited = probe.exited;
  await fresh(); await probe.resume(report.threadId);
  await gate('resume', async () => {
    const after = probe.cursor; const { turnId } = await probe.start('Do not use tools. What exact token did I ask you to remember in my preceding message? Reply with only the token.');
    const answer = await finish(turnId, after);
    log('resume', { status: answer.includes(nonce) && report.firstProcessExited && report.processes[0] !== report.processes[1] ? 'passed' : 'failed', turnId, tokenMatched: answer.includes(nonce) });
  });
  await gate('steer', async () => {
    const after = probe.cursor;
    const { turnId } = await probe.start('Do not use tools. First send a short progress message saying READY. Then give a detailed proof that there are infinitely many primes.');
    await probe.waitFor('item/agentMessage/delta', e => e.params.threadId === probe.threadId && e.params.turnId === turnId, { after });
    const marker = 'STEER_' + randomUUID();
    const ack = await probe.steer(`Change the requested answer: reply only with ${marker}. No proof is needed.`);
    report.gates.steer = { status: 'pending', turnId, sameTurn: ack.turnId === turnId };
    const answer = await finish(turnId, after);
    log('steer', { status: ack.turnId === turnId && answer.includes(marker) ? 'passed' : 'failed', turnId, sameTurn: ack.turnId === turnId, markerMatched: answer.includes(marker) });
  });
  await gate('interrupt', async () => {
    const { turnId } = await probe.start('Do not use tools. Give a thorough, detailed comparison of twenty sorting algorithms, including correctness proofs.');
    const event = await probe.interrupt();
    log('interrupt', { status: event.params.turn.status === 'interrupted' ? 'passed' : 'failed', turnId, terminalStatus: event.params.turn.status });
  });
  await gate('approval', async () => {
    const marker = join(cwd, 'approval-marker.txt'); const after = probe.cursor;
    const { turnId } = await probe.start(`This is an authorized isolated approval-denial test. Use only the native shell command tool to attempt once: node -e 'require("node:fs").writeFileSync("approval-marker.txt","test")'. Request approval if needed. Do not use any other tools or try alternate methods. If denied, stop and report denial. Current directory is the test fixture directory.`);
    await finish(turnId, after);
    const approvals = probe.events.filter(e => e.seq > after && e.method === 'probe/approval' && e.params.threadId === probe.threadId && e.params.turnId === turnId).map(e => e.params);
    let markerExists = false; try { await access(marker); markerExists = true; } catch {}
    log('approval', { status: markerExists ? 'failed' : approvals.length ? 'passed' : 'unverified', turnId, markerExists, approvals });
  });
} catch (error) { report.error = error.message; console.log(JSON.stringify({ error: report.error })); }
finally {
  if (probe) {
    try { await probe.close(); report.finalProcessExited = probe.exited; }
    catch (error) { report.cleanupError = error.message; report.finalProcessExited = false; }
  }
  for (const name of ['create', 'resume', 'steer', 'interrupt', 'approval']) report.gates[name] ||= { status: 'unverified' };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${output}`);
  // Keep the report and native test session; remove only the disposable marker.
  await rm(join(cwd, 'approval-marker.txt'), { force: true });
  if (report.cleanupError || Object.values(report.gates).some(g => g.status !== 'passed')) process.exitCode = 1;
}
