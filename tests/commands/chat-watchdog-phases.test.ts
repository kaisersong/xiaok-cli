import {describe,it,expect,vi} from 'vitest';
import {createTurnActivityWatchdog} from '../../src/commands/chat-runtime-config.js';
describe('chat runtime phase watchdog',()=>{
 it('rearms after a tool and hands model recovery to its owner',()=>{
  vi.useFakeTimers();try {
   const w=createTurnActivityWatchdog(100);
   w.observeRuntimeEvent({type:'model_request_started'});
   vi.advanceTimersByTime(1000);expect(w.didTimeout()).toBe(false);
   w.observeRuntimeEvent({type:'tool_started'});
   vi.advanceTimersByTime(1000);expect(w.didTimeout()).toBe(false);
   w.observeRuntimeEvent({type:'tool_finished'});
   for(let i=0;i<10;i++){vi.advanceTimersByTime(90);w.observeRuntimeEvent({type:'execution_progress'});}
   expect(w.didTimeout()).toBe(false);
   vi.advanceTimersByTime(100);expect(w.didTimeout()).toBe(true);w.dispose();
  }finally{vi.useRealTimers();}
 });
});
