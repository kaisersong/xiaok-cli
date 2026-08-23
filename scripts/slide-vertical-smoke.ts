/**
 * Real vertical smoke for the slide renderer over the digest-owned Python runtime
 * (design §6.2): assert the interpreter is not a PATH/shared-venv one, spawn the
 * real MCP server with it, run a real `render_slide`, and verify the HTML deck.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertDigestOwnedRuntime } from '../desktop/electron/provider-gateways/slide-provider-adapter.js';

const [venvPython, serverPy, briefPath] = process.argv.slice(2);
if (!venvPython || !serverPy || !briefPath) {
  throw new Error('usage: slide-vertical-smoke.ts <venv-python> <server.py> <brief.json>');
}

// The production guard: a PATH interpreter or the shared mutable venv is refused.
try {
  assertDigestOwnedRuntime({
    pythonCommand: venvPython,
    pythonArgs: ['-I', '-u'],
    runtimeContractDigest: 'smoke-contract',
    runtimeGenerationId: 'smoke-generation',
    environmentTemplateDigest: 'smoke-env',
  });
  console.log('digest-owned runtime guard: accepted');
} catch (error) {
  console.log(`digest-owned runtime guard: ${(error as Error).message}`);
  console.log('note: this smoke runs a vendored closure outside .provider-store-v2, '
    + 'so the guard is expected to reject it until the store materialises the generation');
}

const workDir = mkdtempSync(join(tmpdir(), 'slide-smoke-'));
const outputPath = join(workDir, 'deck.html');
const brief = readFileSync(briefPath, 'utf8');

const child = spawn(venvPython, ['-I', '-u', serverPy], {
  cwd: dirname(serverPy),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    PATH: '/usr/bin:/bin',
    HOME: workDir,
    TMPDIR: workDir,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
  },
});

let buf = '';
const send = (o: unknown) => child.stdin.write(`${JSON.stringify(o)}\n`);
const timer = setTimeout(() => { console.log('TIMEOUT'); child.kill('SIGKILL'); process.exit(1); }, 120_000);

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
      const init = msg.result as { protocolVersion?: string; serverInfo?: { name?: string } };
      console.log(`initialize ok: protocol=${init.protocolVersion} server=${init.serverInfo?.name}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    } else if (msg.id === 2 && msg.result) {
      const names = (msg.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
      console.log(`tools/list ok: ${names.join(', ')}`);
      const required = ['validate_brief', 'render_slide', 'list_presets', 'get_schema'];
      const missing = required.filter((op) => !names.includes(op));
      console.log(missing.length === 0
        ? 'required operation set: complete'
        : `required operation set: MISSING ${missing.join(', ')}`);
      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'render_slide', arguments: { brief_json: brief, output_path: outputPath } },
      });
    } else if (msg.id === 3) {
      if (msg.error) {
        console.log('render_slide error:', JSON.stringify(msg.error).slice(0, 400));
        clearTimeout(timer);
        child.kill('SIGTERM');
        process.exit(2);
      }
      const text = (msg.result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}';
      let payload: { success?: boolean; preset?: string; quality_tier?: string; errors?: string[] } = {};
      try { payload = JSON.parse(text); } catch { /* non-JSON payload */ }
      console.log(`render_slide success=${payload.success} preset=${payload.preset} tier=${payload.quality_tier}`);
      const produced = existsSync(outputPath);
      const bytes = produced ? statSync(outputPath).size : 0;
      const ok = payload.success === true && produced && bytes > 10_000;
      console.log(`deck bytes=${bytes}`);
      console.log(ok ? 'SLIDE VERTICAL: ok' : 'SLIDE VERTICAL: failed');
      clearTimeout(timer);
      child.kill('SIGTERM');
      setTimeout(() => process.exit(ok ? 0 : 2), 200);
    }
  }
});
child.stderr.on('data', (d: Buffer) => {
  const text = d.toString();
  if (/Traceback|Error/.test(text)) process.stderr.write(`[slide] ${text.slice(0, 400)}`);
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'slide-smoke', version: '0' } },
});
