import {describe,it,expect,vi} from 'vitest';
import {createExecutionHealthMonitor} from '../../src/runtime/execution-health.js';
describe('execution health owner',()=>{
 it('uses genuine progress, nested waits and terminal fencing',()=>{
  vi.useFakeTimers();try {
   const timeout=vi.fn();const states:string[]=[];
   const m=createExecutionHealthMonitor({idleMs:100,onStalled:timeout,onState:s=>states.push(s)});
   vi.advanceTimersByTime(90);m.progress();vi.advanceTimersByTime(90);expect(timeout).not.toHaveBeenCalled();
   m.wait('a');m.wait('b');vi.advanceTimersByTime(1000);m.resume('a');vi.advanceTimersByTime(1000);expect(timeout).not.toHaveBeenCalled();
   m.resume('b');vi.advanceTimersByTime(100);expect(timeout).toHaveBeenCalledOnce();
   m.progress();vi.advanceTimersByTime(1000);expect(timeout).toHaveBeenCalledOnce();
   expect(states).toContain('cleanup_pending');m.dispose();
  }finally{vi.useRealTimers();}
 });
});
