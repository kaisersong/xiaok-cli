#!/usr/bin/env node
// Real production CLI + owned PTY + Ghostty VT engine. No native window/GPU claim.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pty from 'node-pty';
import { createGhosttyVt } from '../support/ghostty-vt.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entry = resolve(process.argv[2] ?? join(repo, 'dist/index.js'));
const { resolveXiaokDaemonSocketPath } = await import(pathToFileURL(join(repo, 'dist/runtime/daemon/protocol.js')).href);
const { queryXiaokDaemonStatus, stopXiaokDaemon } = await import(pathToFileURL(join(repo, 'dist/runtime/daemon/control.js')).href);
const root = mkdtempSync(join(realpathSync(tmpdir()), 'xiaok-ghostty-vt-footer-'));
const home = join(root, 'home'), config = join(root, 'config'), cwd = join(root, 'project');
const socketPath = resolveXiaokDaemonSocketPath(`${userInfo().username}:${home}`);
for (const path of [home, config, cwd]) mkdirSync(path);
const { terminal, snapshot } = await createGhosttyVt();
const requests = [];
const history = Array.from({ length: 75 }, (_, i) => `PRESERVED_LINE_${String(i).padStart(3, '0')}`);
const answer = history.join('\n') + '\nFINAL_RESPONSE_MARKER';
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
  const content = requests.length === 1 ? answer : 'NEXT_TURN_CONFIRMED';
  for (const delta of [{ role: 'assistant', content }, {}]) {
    response.write(`data: ${JSON.stringify({ id: 'synthetic-footer', object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: delta.content ? null : 'stop' }] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
writeFileSync(join(config, 'config.json'), JSON.stringify({ schemaVersion: 1, defaultModel: 'custom',
  models: { custom: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-test-key', model: 'footer-test' } },
  defaultMode: 'interactive', contextBudget: 4000, channels: {}, memory: { enabled: false },
  automations: { enabled: false }, intentBoundary: { enabled: false } }));
const env = { ...process.env, HOME: home, USERPROFILE: home, XIAOK_TEST_ACCOUNT_HOME: home,
  XIAOK_CONFIG_DIR: config, XIAOK_DISABLE_GLOBAL_PLUGINS: '1', NO_COLOR: '', TERM: 'xterm-256color' };
// Model SSH without relying on TERM_PROGRAM/Ghostty-specific variables.
delete env.TMUX; delete env.STY; delete env.TERM_PROGRAM;
let child, exited = false, raw = '';
const text = () => snapshot().text;
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 30000;
  while (!predicate()) {
    assert(!exited && Date.now() < deadline, `waiting for ${label}; evidence: ${root}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
};
try {
  child = pty.spawn(process.execPath, ['--import', join(repo, 'tests/support/profile-account-child.setup.mjs'), entry, '--yolo'],
    { name: 'xterm-256color', cols: 110, rows: 40, cwd, env });
  writeFileSync(join(root, 'owned-pids.json'), JSON.stringify({ pids: [child.pid] }));
  child.onData(bytes => { raw += bytes; terminal.write(bytes); });
  child.onExit(() => { exited = true; });
  await waitFor(() => text().includes('❯'), 'startup');
  child.write('Fill the synthetic transcript\r');
  await waitFor(() => text().includes('FINAL_RESPONSE_MARKER') && text().includes('❯'), 'answer');
  child.write('DRAFT_中文');
  await waitFor(() => text().includes('DRAFT_中文'), 'draft');
  for (const [index, [cols, rows]] of [[65, 24], [110, 40], [40, 20], [100, 34], [55, 24], [110, 40]].entries()) {
    terminal.resize(cols, rows); child.resize(cols, rows);
    await new Promise(resolve => setTimeout(resolve, 250));
    const screen = text();
    writeFileSync(join(root, `resize-${index}.txt`), screen);
    const { grayRows } = snapshot();
    assert.deepEqual(grayRows, [grayRows[0], grayRows[0] + 1, grayRows[0] + 2], 'detached background cells');
    writeFileSync(join(root, `resize-${index}-gray.json`), JSON.stringify(grayRows));
    for (const marker of history) assert.equal(screen.split(marker).length, 2, marker);
    assert(screen.includes('FINAL_RESPONSE_MARKER'));
    assert.equal(screen.split('DRAFT_中文').length, 2, `duplicate draft at ${cols}x${rows}`);
    child.write('X'); await waitFor(() => text().includes('DRAFT_中文X'), 'edit');
    child.write('\x7f'); await waitFor(() => !text().includes('DRAFT_中文X') && text().includes('DRAFT_中文'), 'backspace');
  }
  child.write('\r');
  await waitFor(() => text().includes('NEXT_TURN_CONFIRMED'), 'next answer');
  const readSession = () => JSON.parse(readFileSync(join(config, 'sessions', readdirSync(join(config, 'sessions')).find(file => file.endsWith('.json'))), 'utf8'));
  await waitFor(() => readSession().messages.filter(message => message.role === 'user').at(-1)?.content.at(-1)?.text === 'DRAFT_中文', 'persisted next input');
  const session = readSession();
  const saved = session.messages.filter(message => message.role === 'user').at(-1).content;
  assert.equal(saved.at(-1).text, 'DRAFT_中文');
  const content = requests.at(-1).messages.filter(message => message.role === 'user').at(-1).content;
  assert.deepEqual(content, typeof content === 'string' ? saved.map(block => block.text).join('') : saved);
  writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: true, entry, resizeCases: 6, exactNextInput: true }));
  console.log('PASS: real CLI PTY/Ghostty VT; six resizes; full history; editable draft; exact next input');
} finally {
  if (child && !exited) {
    child.write('/exit\r');
    const deadline = Date.now() + 3000;
    while (!exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    if (!exited) child.kill();
    const killDeadline = Date.now() + 3000;
    while (!exited && Date.now() < killDeadline) await new Promise(resolve => setTimeout(resolve, 30));
  }
  // The CLI may launch its reminder daemon even when the synthetic model has
  // no tools. Address only this fixture's socket and record its acknowledged PID.
  const daemon = await queryXiaokDaemonStatus(socketPath);
  writeFileSync(join(root, 'owned-pids.json'), JSON.stringify({ pids: child ? [child.pid] : [], daemon, socketPath }));
  if (daemon) await stopXiaokDaemon(socketPath);
  const daemonDeadline = Date.now() + 3000;
  let daemonRemaining = await queryXiaokDaemonStatus(socketPath);
  while (daemonRemaining && Date.now() < daemonDeadline) {
    await new Promise(resolve => setTimeout(resolve, 30));
    daemonRemaining = await queryXiaokDaemonStatus(socketPath);
  }
  writeFileSync(join(root, 'terminal.raw'), raw);
  terminal.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  writeFileSync(join(root, 'cleanup.json'), JSON.stringify({ ownedCliRemaining: child && !exited ? 1 : 0, ownedDaemonRemaining: daemonRemaining ? 1 : 0, serverClosed: true }));
  console.log(`CLEANUP: owned CLI remaining=${child && !exited ? 1 : 0}; owned daemon remaining=${daemonRemaining ? 1 : 0}; local SSE closed; EVIDENCE ${root}`);
  assert(!child || exited, 'owned CLI did not exit');
  assert(!daemonRemaining, 'owned daemon did not stop');
}
