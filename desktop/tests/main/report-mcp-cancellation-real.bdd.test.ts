// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReportArtifactTool } from '../../electron/desktop-services.js';
import { mcpTestContext } from '../../../tests/support/mcp-cancellation-context.js';

// Real bundled-entry wrapper + actual modern v2 stdio server, not the mocked SDK receiver suite.
describe('M7 real modern stdio report cancellation', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.unstubAllEnvs(); });
  it.each(['startup', 'call'] as const)('cancels the %s boundary, refuses late success, and closes its invocation-owned process', async stage => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-report-cancel-real-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    const dir = join(root, 'config', 'plugins', 'kai-report-creator', 'mcp-servers', 'report-renderer', 'dist'); mkdirSync(dir, { recursive: true });
    const journal = join(root, 'fixture-events.jsonl'); const release = join(root, 'release'); const output = join(root, 'output', 'report.html');
    const require = createRequire(import.meta.url);
    const serverUrl = pathToFileURL(require.resolve('@modelcontextprotocol/server')).href;
    const stdioUrl = pathToFileURL(require.resolve('@modelcontextprotocol/server/stdio')).href;
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(dir, 'server.bundle.js'), `
      import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
      import { Server } from ${JSON.stringify(serverUrl)};
      import { serveStdio } from ${JSON.stringify(stdioUrl)};
      const log = type => appendFileSync(${JSON.stringify(journal)}, JSON.stringify({type,pid:process.pid})+'\\n');
      const wait = async () => { while (!existsSync(${JSON.stringify(release)})) await new Promise(resolve => setTimeout(resolve, 10)); };
      process.on('SIGTERM', () => { log('sigterm'); process.exit(0); });
      process.on('exit', () => log('exit'));
      log('started');
      if (${JSON.stringify(stage)} === 'startup') await wait();
      serveStdio(() => {
        const server = new Server({name:'report-cancellation-fixture',version:'1'}, {capabilities:{tools:{}}});
        server.setRequestHandler('tools/list', async () => ({tools:[{name:'render_report',description:'fixture',inputSchema:{type:'object'}}]}));
        server.setRequestHandler('tools/call', async request => {
          log('call-entered'); await wait();
          writeFileSync(request.params.arguments.output_path, '<html>controlled late report</html>'); log('effect');
          return {content:[{type:'text',text:JSON.stringify({success:true})}]};
        });
        return server;
      });
    `);
    const rows = () => existsSync(journal) ? readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; pid: number }) : [];
    const controller = new AbortController(); const reason = new Error(`cancel real report ${stage}`);
    const tool = createReportArtifactTool();
    const outcome = tool.execute({ ir_content: '# controlled fixture', output_path: output }, mcpTestContext(controller.signal)).then(value => ({ value }), error => ({ error }));
    try {
      await vi.waitFor(() => expect(rows().some(row => row.type === (stage === 'startup' ? 'started' : 'call-entered'))).toBe(true), { timeout: 2500 });
      controller.abort(reason);
      // Release the controlled remote barrier only after cancellation; no Promise race used by the SUT.
      writeFileSync(release, 'release');
      expect(await outcome).toEqual({ error: reason });
    } finally {
      writeFileSync(release, 'release'); await outcome;
      const pid = rows().find(row => row.type === 'started')?.pid;
      if (pid) await vi.waitFor(() => {
        let alive = true; try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error; }
        expect(alive, 'invocation-owned fixture process must actually exit').toBe(false);
      }, { timeout: 2500 });
    }
  });
});
