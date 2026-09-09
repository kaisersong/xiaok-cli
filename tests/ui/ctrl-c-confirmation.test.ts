import {describe,it,expect,vi} from 'vitest';
import {createExitConfirmation} from '../../src/ui/exit-confirmation.js';
import {InputReader} from '../../src/ui/input.js';
import {ReplRenderer} from '../../src/ui/repl-renderer.js';
import {createTtyHarness} from '../support/tty.js';
describe('Ctrl+C confirmation',()=>{
 it('requires two presses within the window, and ordinary input resets it',()=>{
  let now=0;const gate=createExitConfirmation(()=>now);
  expect(gate.press()).toBe(false);now=100;expect(gate.press()).toBe(true);
  gate.reset();expect(gate.press()).toBe(false);now=2200;expect(gate.press()).toBe(false);
  gate.reset();expect(gate.press()).toBe(false);
 });
 it('routes single, batched and mixed Ctrl+C without losing the draft',async()=>{
  const h=createTtyHarness();const events:string[]=[];const reader=new InputReader();
  reader.setInterruptHandler(()=>events.push('interrupt'),()=>events.push('input'));
  try{
   let resolved=false;const read=reader.read('> ');void read.then(()=>{resolved=true});
   h.send('draft\x03');await Promise.resolve();expect(resolved).toBe(false);
   h.send('\x03x\x03');expect(events).toEqual(['input','interrupt','interrupt','input','interrupt']);
   h.send('\r');expect(await read).toBe('draftx');
  }finally{h.restore()}
 });
 it('keeps queued and draft input while routing busy Ctrl+C; ESC still aborts',()=>{
  const h=createTtyHarness();const reader=new InputReader(new ReplRenderer(process.stdout));
  const interrupt=vi.fn(),abort=vi.fn();reader.setInterruptHandler(interrupt);
  const busy=reader.startBusyCapture({onAbortRequest:abort});
  try{h.send('queued\r');h.send('draft\x03');expect(interrupt).toHaveBeenCalledTimes(1);expect(abort).not.toHaveBeenCalled();expect(busy.getSnapshot().draft).toBe('draft');expect(busy.consumeQueued()).toBe('queued');h.send('\x1b');expect(abort).toHaveBeenCalledTimes(1)}finally{busy.stop();h.restore()}
 });
});
