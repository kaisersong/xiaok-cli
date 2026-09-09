import {afterEach,describe,expect,it,vi} from 'vitest';
import {InputReader} from '../../src/ui/input.js';
import {ReplRenderer} from '../../src/ui/repl-renderer.js';
import {retainRawInputModeForSession} from '../../src/ui/input-mode.js';
import {createTtyHarness} from '../support/tty.js';
const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform')!;
afterEach(()=>{Object.defineProperty(process,'platform',originalPlatform);vi.restoreAllMocks()});
describe('Windows input ownership handoff',()=>{
 it.each(['win32','darwin'] as const)('preserves raw only during a Windows session (%s)',async platform=>{
  Object.defineProperty(process,'platform',{...originalPlatform,value:platform});
  const h=createTtyHarness();const release=retainRawInputModeForSession();
  try{
   const reader=new InputReader(new ReplRenderer(process.stdout));
   const pending=reader.read('> ');h.send('hello');h.send('\r');expect(await pending).toBe('hello');
   const busy=reader.startBusyCapture();busy.stop();
   if(platform==='win32')expect(process.stdin.setRawMode).not.toHaveBeenCalledWith(false);
   else expect(process.stdin.setRawMode).toHaveBeenCalledWith(false);
  }finally{release();h.restore()}
 });
 it('external process still gets cooked stdin and the read draft survives',async()=>{
  Object.defineProperty(process,'platform',{...originalPlatform,value:'win32'});
  const h=createTtyHarness();const release=retainRawInputModeForSession();
  try{
   const reader=new InputReader();const pending=reader.read('> ');h.send('draft');
   const external=reader.suspendForExternalProcess();expect(process.stdin.setRawMode).toHaveBeenLastCalledWith(false);
   external.resume();expect(process.stdin.setRawMode).toHaveBeenLastCalledWith(true);
   h.send('\r');expect(await pending).toBe('draft');
  }finally{release();h.restore()}
 });
 it('nested owners restore the original mode only once at final release',()=>{
  Object.defineProperty(process,'platform',{...originalPlatform,value:'win32'});
  const h=createTtyHarness();const original=Boolean(process.stdin.isRaw);
  const a=retainRawInputModeForSession(),b=retainRawInputModeForSession();
  try{a();a();expect(process.stdin.setRawMode).not.toHaveBeenCalled();b();b();expect(process.stdin.setRawMode).toHaveBeenCalledExactlyOnceWith(original)}finally{a();b();h.restore()}
 });
});
