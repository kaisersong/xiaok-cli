import { describe, it, expect, vi } from 'vitest';
import { recoverModelStream } from '../../../src/ai/runtime/model-stream-recovery.js';
const policy = { windowMs: 100, idleMs: 20, initialDelayMs: 1, maxDelayMs: 2 };
async function collect(stream: AsyncIterable<unknown>) { const values=[]; for await (const value of stream) values.push(value); return values; }
describe('model stream recovery', () => {
  it('recovers a terminated stream', async () => {
    let calls=0;
    const reset=vi.fn();
    const result=await collect(recoverModelStream({ signal: new AbortController().signal, policy, onRetry: reset,
      open: async function* () { if (++calls===1) throw new TypeError('terminated'); yield {type:'text' as const,delta:'ok'}; } }));
    expect(calls).toBe(2);expect(reset).toHaveBeenCalledTimes(1);expect(result).toEqual([{type:'text',delta:'ok'}]);
  });
  it('does not retry authentication failures even if their text mentions network', async () => {
    const open=vi.fn(async function* () { throw Object.assign(new Error('network authentication failed'),{status:401}); });
    await expect(collect(recoverModelStream({signal:new AbortController().signal,policy,open}))).rejects.toThrow('authentication');
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('does not retry wrapped authentication errors or loop on cyclic causes', async () => {
    const auth = Object.assign(new Error('denied'), {status:401});
    const wrapped = new Error('network request failed', {cause:auth});
    const cycle = new Error('permanent failure');
    Object.assign(cycle, {cause:new Error('wrapper', {cause:cycle})});
    for (const error of [wrapped, cycle]) {
      const open = vi.fn(async function* () {throw error;});
      await expect(collect(recoverModelStream({signal:new AbortController().signal,policy,open}))).rejects.toBe(error);
      expect(open).toHaveBeenCalledTimes(1);
    }
  });
  it('discards a late response from an abandoned idle request', async () => {
    let calls = 0;
    let oldSignal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const values = await collect(recoverModelStream({signal:new AbortController().signal,policy,
      onRetry: () => release(),
      open: async function* (signal) {
        if (++calls === 1) {oldSignal = signal; await gate; yield {type:'text' as const,delta:'STALE'};}
        else yield {type:'text' as const,delta:'CURRENT'};
      }}));
    expect(oldSignal?.aborted).toBe(true);
    expect(values).toEqual([{type:'text',delta:'CURRENT'}]);
  });
  it('bounds never-settling requests and cancels the owned attempt', async () => {
    let signal: AbortSignal | undefined;
    await expect(collect(recoverModelStream({signal:new AbortController().signal,policy,
      open: async function* (owned) { signal=owned; await new Promise(()=>{}); } }))).rejects.toThrow('恢复');
    expect(signal?.aborted).toBe(true);
  });
  it('user cancellation interrupts retry delay immediately', async () => {
    const controller=new AbortController();
    const result=collect(recoverModelStream({signal:controller.signal,policy:{...policy,initialDelayMs:1000},
      onRetry:()=>controller.abort(),open:async function* () {throw new Error('ECONNRESET');} }));
    await expect(result).rejects.toMatchObject({name:'AbortError'});
  });
});
