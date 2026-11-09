#!/usr/bin/env node
// Exercise the production /dev/tty transport and late-reply filter through a
// real PTY. xterm owns CPR generation; no application query logic is duplicated.
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import xterm from '@xterm/headless';

if (process.platform === 'win32') {
  console.log('SKIP: POSIX raw TTY cursor queries are disabled on Windows');
  process.exit(0);
}
const pty = await import('node-pty');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const keyboardUrl = pathToFileURL(path.join(repo, 'dist/ui/keyboard-protocol.js')).href;
const moduleUrl = pathToFileURL(path.join(repo, 'dist/ui/terminal-cursor.js')).href;
const childCode = `
import { readTerminalCursor, cancelPendingCursorReport, waitForTerminalCursorReport } from ${JSON.stringify(moduleUrl)};
import { retainKeyboardProtocol, normalizeEnhancedKeys } from ${JSON.stringify(keyboardUrl)};
const chunks = [];
process.stdin.setRawMode(true); process.stdin.resume();
const release = retainKeyboardProtocol();
if (process.argv[1] !== 'legacy') normalizeEnhancedKeys(Buffer.from('\\x1b[27u'));
if (process.argv[1] === 'tmux') process.env.TMUX = 'owned-test';
if (process.argv[1] === 'screen') process.env.STY = 'owned-test';
process.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)));
setTimeout(() => {
  const position = readTerminalCursor(process.stdout, '\\x1b[10;5H');
  process.stdout.write('\\r\\nPOSITION:' + JSON.stringify(position) + '\\r\\n');
  setTimeout(async () => {
    const drained = await waitForTerminalCursorReport(50);
    process.stdout.write('DRAINED:' + drained + '\\r\\n');
    cancelPendingCursorReport();
    process.stdout.write('INPUT:' + Buffer.concat(chunks).toString('hex') + '\\r\\n');
    release(); process.stdin.setRawMode(false); process.exit(0);
  }, 800);
}, 50);
`;

async function run(kind) {
  const term = new xterm.Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  // This dedicated child is explicitly outside a multiplexer. Do not modify the
  // caller's environment or its terminal/session.
  const env = { ...process.env };
  delete env.TMUX; delete env.STY;
  const child = pty.spawn(process.execPath, ['--input-type=module', '-e', childCode, kind], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: repo, env,
  });
  const timers = [];
  let output = '', exited = false, queries = 0;
  const later = (fn, delay) => { timers.push(setTimeout(fn, delay)); };
  const send = bytes => { if (!exited) child.write(bytes); };
  const input = kind === 'success' ? '中文\x03\x1b[1;2R' : kind === 'late' ? '中文tail\x03'
    : kind === 'split' ? '中文\x1btail\x03' : ['legacy', 'tmux', 'screen'].includes(kind) ? 'draft\x1b' : 'draft\x1b';
  term.onData(reply => {
    assert.match(reply, /^\x1b\[\?10;5R$/);
    queries++;
    if (kind === 'success') send(input + reply);
    else if (kind === 'late') {
      send('中文' + reply.slice(0, -2));
      // Beyond both the synchronous deadline and a hypothetical 500ms filter.
      later(() => send(reply.slice(-2) + 'tail\x03'), 650);
    } else if (kind === 'split') {
      send('中文' + reply.slice(0, 1));
      later(() => send('\x1b[27u'), 250);
      later(() => send(reply.slice(1) + 'tail\x03'), 650);
    } else {
      send('draft'); later(() => send('\x1b[27u'), 250);
    }
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`TTY timeout (${kind}): ${output}`)), 5000);
      timers.push(timeout);
      if (['legacy', 'tmux', 'screen'].includes(kind)) later(() => send('draft\x1b'), 100);
      child.onData(data => { output += data; term.write(data); });
      child.onExit(event => {
        exited = true; clearTimeout(timeout);
        if (event.exitCode === 0) resolve(); else reject(new Error(`TTY child failed: ${output}`));
      });
    });
    const rawPosition = /POSITION:([^\r\n]+)/.exec(output)?.[1];
    assert.ok(rawPosition, output);
    const position = JSON.parse(rawPosition);
    assert.equal(queries, ['legacy', 'tmux', 'screen'].includes(kind) ? 0 : 1, output);
    if (kind === 'success') assert.deepEqual(position, { row: 10, column: 5, columns: 80, rows: 24 });
    else assert.equal(position, null);
    assert.equal(/DRAINED:(true|false)/.exec(output)?.[1], kind === 'unsupported' ? 'false' : 'true', output);
    assert.equal(/INPUT:([a-f0-9]*)/.exec(output)?.[1], Buffer.from(input).toString('hex'), output);
    console.log(`PASS: raw TTY ${kind}; CPR isolated; exact UTF-8/control-key input`);
  } finally {
    timers.forEach(clearTimeout);
    if (!exited) child.kill();
    term.dispose();
  }
}
for (const kind of ['legacy', 'tmux', 'screen', 'success', 'late', 'split', 'unsupported']) await run(kind);
console.log('CLEANUP: 7 owned PTY children exited; remaining=0');
