import {it, expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const transportUrl = new URL('../../../src/platform/mcp/transport.js', import.meta.url).href;
for (const mode of ['natural', 'forced']) {
  it(`keeps an isolated Node alive until an unref MCP child has ${mode} exit`, async () => {
    const script = `
      import {spawn} from 'node:child_process';
      const {waitForProcessExit}=await import(${JSON.stringify(transportUrl)});
      const child=spawn(process.execPath,['-e',${JSON.stringify(mode === 'natural' ? 'setTimeout(()=>{},150)' : 'setInterval(()=>{},1000)')}],{stdio:'ignore'});
      console.log('owned-child:'+child.pid);child.unref();
      await waitForProcessExit(child.pid,${mode === 'natural' ? 2000 : 150});
      console.log('closed');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', timeout: 5000,
    });
    const pid = Number(/owned-child:(\d+)/.exec(result.stdout ?? '')?.[1]);
    // Clean only this test's reported child, including the old-code counterfactual.
    if (Number.isSafeInteger(pid) && pid > 0) {
      await delay(250);
      try { process.kill(pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    expect(result.status, result.stderr || String(result.error)).toBe(0);
    expect(result.stdout).toContain('closed');
  });
}
