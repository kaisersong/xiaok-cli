import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.R247_ROOT, instance = process.env.R247_INSTANCE;
const port = Number(process.env.R247_PORT);
if (!root || !instance || !Number.isInteger(port) || port <= 0) throw Error('own_fixture_input_invalid');
const held = new Set(); let closing = false;
const page = { ok: true, sourceDataEpoch: instance, headSeq: 0, nextCursor: 0, gap: false,
  snapshot: { status: 'working' }, events: [] };
const server = createServer((request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, fixtureInstance: instance, service: { pid: process.pid } })); return;
  }
  if (request.headers['x-r247-fixture-instance'] !== instance) { response.statusCode = 403; response.end(); return; }
  if (request.url === '/project' && request.method === 'GET' && !closing) {
    held.add(response); response.once('close', () => held.delete(response));
    writeFileSync(join(root, 'project-entered.json'), JSON.stringify({ pid: process.pid, instance }), { mode: 0o600, flag: 'wx' }); return;
  }
  if (request.url === '/release' && request.method === 'POST' && !closing) {
    closing = true;
    for (const pending of held) { pending.setHeader('content-type', 'application/json'); pending.end(JSON.stringify(page)); }
    response.end(JSON.stringify({ accepted: true }));
    // This is only this OWN fixture server's concrete release, not a product
    // quiescent ACK. Real held responses and real Node server.close must settle.
    server.close(error => {
      if (error) { process.exitCode = 1; return; }
      writeFileSync(join(root, 'server-closed.json'), JSON.stringify({ pid: process.pid, instance }), { mode: 0o600, flag: 'wx' });
    }); return;
  }
  response.statusCode = closing ? 409 : 404; response.end();
});
server.listen(port, '127.0.0.1', () => writeFileSync(join(root, 'ready.json'), JSON.stringify({ pid: process.pid, instance }), { mode: 0o600, flag: 'wx' }));
process.once('exit', code => writeFileSync(join(root, 'exited.json'), JSON.stringify({ pid: process.pid, instance, code }), { mode: 0o600, flag: 'wx' }));
