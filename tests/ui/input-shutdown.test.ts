import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { InputReader } from '../../src/ui/input.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { createTtyHarness } from '../support/tty.js';

it('host cancellation settles the original TTY confirmation read and permits ordinary read reuse', async () => {
  const harness = createTtyHarness();
  const reader = new InputReader(new ReplRenderer(process.stdout));
  const initialListeners = process.stdin.listenerCount('data');
  try {
    const confirmation = reader.read('确认？输入 yes：');
    harness.send('unfinished draft');
    reader.cancelActiveRead();
    reader.cancelActiveRead();
    expect(await confirmation).toBeNull();
    expect(process.stdin.listenerCount('data')).toBe(initialListeners);
    const next = reader.read('> ');
    harness.send('ordinary input'); harness.send('\r');
    expect(await next).toBe('ordinary input');
    reader.cancelActiveRead();
    expect(process.stdin.listenerCount('data')).toBe(initialListeners);
  } finally { harness.send('\x1b'); harness.restore(); }
});

it('first interrupt preserves the original read until the host confirms shutdown', async () => {
  const harness = createTtyHarness(), reader = new InputReader();
  let interruptions = 0, settled = false;
  reader.setInterruptHandler(() => { interruptions++; if (interruptions === 2) reader.cancelActiveRead(); });
  try {
    const original = reader.read('Goal confirmation');
    void original.then(() => { settled = true; });
    harness.send('\x03'); await Promise.resolve();
    expect(interruptions).toBe(1); expect(settled).toBe(false);
    harness.send('\x03');
    expect(await original).toBeNull();
    expect(interruptions).toBe(2);
  } finally { reader.setInterruptHandler(); harness.send('\x1b'); harness.restore(); }
});

it('host cancellation closes the actual non-TTY readline while stdin remains open', async () => {
  const source = pathToFileURL(resolve('src/ui/input.ts')).href;
  const script = `import {InputReader} from ${JSON.stringify(source)};
    const reader=new InputReader();let cancelled=false;const original=reader.read('non-tty confirmation');
    setTimeout(()=>{cancelled=true;reader.cancelActiveRead();reader.cancelActiveRead();},20);
    if(await original!==null||!cancelled)throw Error('original readline did not cancel');
    console.log('ORIGINAL_READ_SETTLED');`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=String(data);});child.stderr.on('data',data=>{stderr+=String(data);});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  try {
    const code=await new Promise<number|null>(resolve=>child.once('exit',resolve));
    expect(code,stderr).toBe(0);expect(stdout).toContain('ORIGINAL_READ_SETTLED');
    expect(child.stdin.writableEnded).toBe(false);
  } finally { clearTimeout(timer);child.stdin.destroy(); }
},20000);

it('host close settles the current read and permanently refuses new input', async () => {
  const harness=createTtyHarness(),reader=new InputReader();
  const initialListeners=process.stdin.listenerCount('data');
  try {
    const original=reader.read('confirmation');reader.close();reader.close();
    expect(await original).toBeNull();expect(await reader.read('new input')).toBeNull();
    expect(process.stdin.listenerCount('data')).toBe(initialListeners);
  } finally { reader.close();harness.restore(); }
});
