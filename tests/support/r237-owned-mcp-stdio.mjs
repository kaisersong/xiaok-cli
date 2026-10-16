import { existsSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
const ready = process.env.R237_READY_FILE, release = process.env.R237_RELEASE_FILE;
const closed = process.env.R237_CLOSED_FILE, exited = process.env.R237_EXIT_FILE;
if (!ready || !release || !closed || !exited) throw Error('owned_stdio_paths_required');
// Exclusive creation detects an unwanted extra era-probe/second process.
writeFileSync(ready, JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' });
process.once('exit', code => writeFileSync(exited, JSON.stringify({ pid: process.pid, code }), { mode: 0o600, flag: 'wx' }));
await new Promise(resolve => {
  const timer = setInterval(() => { if (existsSync(release)) { clearInterval(timer); resolve(); } }, 10);
});
const server = new McpServer({ name: 'r237-owned-stdio', version: '1.0.0' });
const handle = serveStdio(() => server);
process.stdin.once('end', () => {
  void handle.close().then(() => {
    writeFileSync(closed, JSON.stringify({ pid: process.pid, observed: 'stdin-end-and-public-handle-close' }), { mode: 0o600, flag: 'wx' });
  }).catch(() => { process.exitCode = 1; });
});
