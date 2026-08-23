/**
 * Real-ABI verification against the installed cua-driver (design R26-01, R34-01).
 * Reads the live legacy `tools/list` and feeds it to the production
 * `verifyBackendAbi`, so the frozen contract table is checked against the real
 * catalog rather than a hand-written fixture.
 */
import { spawn } from 'node:child_process';
import { verifyBackendAbi } from '../src/platform/computer-use/cua-action-contract.js';

const driver = process.argv[2];
if (!driver) throw new Error('usage: cua-abi-check.ts <path-to-cua-driver>');

const child = spawn(driver, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const send = (o: unknown) => child.stdin.write(`${JSON.stringify(o)}\n`);
const timer = setTimeout(() => { console.log('TIMEOUT'); child.kill('SIGKILL'); process.exit(1); }, 40_000);

child.stdout.on('data', (d: Buffer) => {
  buf += d.toString();
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg: { id?: number; result?: unknown; error?: unknown };
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1 && msg.result) {
      const initResult = msg.result as { protocolVersion?: string; serverInfo?: { name?: string } };
      console.log(`initialize ok: protocol=${initResult.protocolVersion} server=${initResult.serverInfo?.name}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    } else if (msg.id === 2 && msg.result) {
      const tools = (msg.result as { tools: Array<{ name: string; inputSchema?: unknown }> }).tools;
      console.log(`tools/list ok: ${tools.length} operations`);
      const catalog = tools.map((tool) => {
        const schema = (tool.inputSchema ?? {}) as {
          required?: string[];
          properties?: Record<string, { type?: string; enum?: unknown[] }>;
        };
        return {
          name: tool.name,
          required: schema.required ?? [],
          properties: schema.properties ?? {},
        };
      });
      const names = catalog.map((c) => c.name);
      console.log(`has standalone screenshot: ${names.includes('screenshot')}`);
      console.log(`has standalone middle_click: ${names.includes('middle_click')}`);
      const verdict = verifyBackendAbi(catalog);
      if (verdict.ok) {
        console.log('ABI VERIFY: ok — frozen contract table matches the live 0.19.3 catalog');
      } else {
        console.log('ABI VERIFY: failed');
        for (const problem of verdict.problems) console.log(`  - ${problem}`);
      }
      clearTimeout(timer);
      child.kill('SIGTERM');
      setTimeout(() => process.exit(verdict.ok ? 0 : 2), 300);
    } else if (msg.error) {
      console.log('ERROR:', JSON.stringify(msg.error).slice(0, 300));
    }
  }
});
child.stderr.on('data', (d: Buffer) => process.stderr.write(`[driver] ${d.toString().slice(0, 200)}`));

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'abi-check', version: '0' } },
});
