import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A frozen baseline may select the original production entry in test setup.
// Normal runs load the actual InputReader source, without replacing its logic.
const entry = (globalThis as { __inputIntegrationEntry?: string }).__inputIntegrationEntry
  ?? pathToFileURL(resolve('src/ui/input.ts')).href;

async function childRead(body: string, replies: Record<string, string | null> = {}) {
  const script = `import {InputReader} from ${JSON.stringify(entry)};
    import {getEventListeners} from 'node:events';
    import assert from 'node:assert/strict';
    const reader=new InputReader();
    const baseline=process.stdin.listenerCount('data');
    ${body}
    assert.equal(process.stdin.listenerCount('data'),baseline);
    // The driver owns the pipe after the read completes; retain it, but stop
    // consuming input so Node can exit after the functional assertions.
    process.stdin.pause();
    console.log('INPUT_INTEGRATION_DONE');`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const sent = new Set<string>();
  child.stdout.on('data', chunk => {
    stdout += String(chunk);
    // Release the parent's pipe only after all child assertions completed.
    if (stdout.includes('INPUT_INTEGRATION_DONE')) child.stdin.end();
    for (const [marker, text] of Object.entries(replies)) {
      if (sent.has(marker) || !stdout.includes(marker)) continue;
      sent.add(marker);
      if (text === null) child.stdin.end(); else child.stdin.write(text);
    }
  });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const result = await new Promise<{ code: number | null; signal: string | null }>((done, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => done({ code, signal }));
    });
    expect(result, stdout + stderr).toEqual({ code: 0, signal: null });
    expect(stdout).toContain('INPUT_INTEGRATION_DONE');
    return stdout;
  } finally { clearTimeout(timer); child.stdin.destroy(); }
}

it('pre-aborted non-TTY reads create no prompt or abort listener', async () => {
  const stdout = await childRead(`const c=new AbortController();c.abort();
    assert.equal(await reader.read('FORBIDDEN_PROMPT',{signal:c.signal}),null);
    assert.equal(getEventListeners(c.signal,'abort').length,0);`);
  expect(stdout).not.toContain('FORBIDDEN_PROMPT');
}, 20000);

it('per-read cancellation releases actual readline and permits another pipe read', async () => {
  await childRead(`const c=new AbortController();
    const first=reader.read('first',{signal:c.signal});setTimeout(()=>c.abort(),20);
    assert.equal(await first,null);assert.equal(getEventListeners(c.signal,'abort').length,0);
    const second=reader.read('second');console.log('SECOND_READY');
    assert.equal(await second,'ordinary answer');`, { SECOND_READY: 'ordinary answer\n' });
}, 20000);

it('host close settles a signalled pipe read and permanently refuses further input', async () => {
  const stdout = await childRead(`const c=new AbortController();
    const first=reader.read('first',{signal:c.signal});
    setTimeout(()=>{reader.close();reader.close();},20);
    assert.equal(await first,null);assert.equal(getEventListeners(c.signal,'abort').length,0);
    assert.equal(await reader.read('CLOSED_PROMPT',{signal:new AbortController().signal}),null);`);
  expect(stdout).not.toContain('CLOSED_PROMPT');
}, 20000);

it('late abort from the answered read cannot cancel the next active read', async () => {
  await childRead(`const old=new AbortController();
    const first=reader.read('first',{signal:old.signal});console.log('FIRST_READY');
    assert.equal(await first,'first answer');assert.equal(getEventListeners(old.signal,'abort').length,0);
    const current=new AbortController();let settled=false;
    const second=reader.read('second',{signal:current.signal});void second.then(()=>{settled=true;});
    old.abort();await Promise.resolve();assert.equal(settled,false);
    setTimeout(()=>current.abort(),20);assert.equal(await second,null);
    assert.equal(getEventListeners(current.signal,'abort').length,0);reader.close();`, { FIRST_READY: 'first answer\n' });
}, 20000);

it('actual pipe EOF settles the read and removes its abort listener', async () => {
  await childRead(`const c=new AbortController();
    const pending=reader.read('eof',{signal:c.signal});console.log('EOF_READY');
    assert.equal(await pending,null);assert.equal(getEventListeners(c.signal,'abort').length,0);`, { EOF_READY: null });
}, 20000);
