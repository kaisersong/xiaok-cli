/**
 * Real vertical smoke for the report renderer over the production host-Node path
 * (design §6.3): resolve the host interpreter identity, spawn the bundled server
 * with it, run a real `render_report`, and verify the produced HTML.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSupportedHostNode,
  resolveHostNodeIdentity,
} from '../src/platform/provider-store/host-node-identity.js';

const [electronExec, serverBundle] = process.argv.slice(2);
if (!electronExec || !serverBundle) {
  throw new Error('usage: report-vertical-smoke.ts <electron-exec> <server.bundle.js>');
}

const identity = resolveHostNodeIdentity({
  execPath: electronExec,
  platform: process.platform,
  // Facts the host reports for this interpreter; the smoke asserts them below.
  nodeVersion: process.env.SMOKE_NODE_VERSION ?? '22.22.1',
  moduleAbi: process.env.SMOKE_MODULE_ABI ?? '140',
  v8Version: process.env.SMOKE_V8 ?? 'unknown',
  appVersion: process.env.SMOKE_APP_VERSION ?? 'dev',
});
assertSupportedHostNode(identity);
console.log(`host identity: node=${identity.nodeVersion} abi=${identity.moduleAbi}`);
console.log(`interpreter inputs covered: ${identity.inputs.length}`);
console.log(`identity digest: ${identity.digest.slice(0, 16)}…`);

const workDir = mkdtempSync(join(tmpdir(), 'report-smoke-'));
const outputPath = join(workDir, 'report.html');
const fixture = process.argv[4]
  ?? '/Users/song/projects/report-creator/examples/business-report.report.md';
const irContent = readFileSync(fixture, 'utf8');
// The document title lives in frontmatter and every `## ` heading becomes a
// section, so both are real content the renderer must reproduce.
const titleProbe = (irContent.match(/^title:\s*(.+)$/m)?.[1] ?? '').trim();
const sectionProbes = [...irContent.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());

const child = spawn(identity.execPathRealpath, [serverBundle], {
  cwd: workDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', HOME: workDir, TMPDIR: workDir },
});

let buf = '';
const send = (o: unknown) => child.stdin.write(`${JSON.stringify(o)}\n`);
const timer = setTimeout(() => { console.log('TIMEOUT'); child.kill('SIGKILL'); process.exit(1); }, 60_000);

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
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'render_report', arguments: { ir_content: irContent, output_path: outputPath } },
      });
    } else if (msg.id === 2) {
      if (msg.error) {
        console.log('render_report error:', JSON.stringify(msg.error).slice(0, 400));
        clearTimeout(timer);
        child.kill('SIGTERM');
        process.exit(2);
      }
      // This server serialises its payload into content[0].text.
      const textPayload = (msg.result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}';
      const structured = JSON.parse(textPayload) as {
        success?: boolean; validation?: Record<string, boolean>; stats?: Record<string, number>;
      };
      console.log(`render_report success=${structured.success} validation=${JSON.stringify(structured.validation)}`);
      console.log(`stats=${JSON.stringify(structured.stats)}`);
      if (!existsSync(outputPath)) {
        console.log('FAILED: no HTML produced');
        child.kill('SIGTERM');
        process.exit(2);
      }
      const html = readFileSync(outputPath, 'utf8');
      const bytes = statSync(outputPath).size;
      const hasTitle = titleProbe.length > 0 && html.includes(titleProbe);
      const missingSections = sectionProbes.filter((heading) => !html.includes(heading));
      const hasUnknown = html.includes('<!-- unknown component: ');
      const ok = structured.success === true
        && hasTitle
        && missingSections.length === 0
        && !hasUnknown
        && (structured.stats?.sections ?? 0) > 0;
      console.log(`html bytes=${bytes} title=${hasTitle} sections=${sectionProbes.length}`
        + ` missingSections=${missingSections.length} unknownComponent=${hasUnknown}`);
      console.log(ok ? 'REPORT VERTICAL: ok' : 'REPORT VERTICAL: failed');
      clearTimeout(timer);
      child.kill('SIGTERM');
      setTimeout(() => process.exit(ok ? 0 : 2), 200);
    }
  }
});
child.stderr.on('data', (d: Buffer) => process.stderr.write(`[report] ${d.toString().slice(0, 300)}`));

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'report-smoke', version: '0' } },
});
