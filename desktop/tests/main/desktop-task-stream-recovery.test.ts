// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { streamDesktopTaskRecovery } from '../../electron/desktop-task-stream.js';
const policy = { windowMs: 100, idleMs: 30, initialDelayMs: 0, maxDelayMs: 0 };
const request = (adapter: any, extra: any = {}) => ({ adapter,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'continue' }] }], tools: [], systemPrompt: '',
  options: { signal: new AbortController().signal }, invocationId: 'first', deadline: Date.now() + 1000, policy, ...extra });
const collect = async (input: any) => { const out = []; for await (const x of streamDesktopTaskRecovery(input)) out.push(x); return out; };
describe('Desktop model request recovery', () => {
  it('recovers before any text without child agents, refreshing request and usage identity', async () => {
    const prepare = vi.fn(async (r: any) => r), ids: string[] = [], signals: AbortSignal[] = [];
    let calls = 0;
    const adapter = { async *stream(_m: any, _t: any, _s: any, o: any) {
      signals.push(o.signal); if (++calls < 3) throw new Error('terminated');
      yield { type: 'text', delta: 'continued' }; yield { type: 'done' };
    } };
    const out = await collect(request(adapter, { prepareRequest: prepare, onInvocation: (id: string) => ids.push(id) }));
    expect(out.some(x => x.delta === 'continued')).toBe(true); expect(calls).toBe(3);
    expect(prepare).toHaveBeenCalledTimes(3); expect(new Set(ids).size).toBe(3);
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(true);
    expect(signals[2].aborted).toBe(false);
  });
  it('never retries preparation or consumer persistence failures', async () => {
    const adapter = { stream: vi.fn(async function*() { yield { type: 'text', delta: 'prefix' }; }) };
    await expect(collect(request(adapter, { prepareRequest: async () => { throw new Error('terminated journal'); } }))).rejects.toThrow('journal');
    expect(adapter.stream).not.toHaveBeenCalled();
    await expect((async () => { for await (const _x of streamDesktopTaskRecovery(request(adapter))) throw new Error('terminated consumer'); })()).rejects.toThrow('consumer');
    expect(adapter.stream).toHaveBeenCalledOnce();
  });
  it('never retries a failed recovery status write or revoked authorization', async () => {
    let calls = 0; const adapter = { async *stream() { calls++; throw new Error('terminated'); } };
    await expect(collect(request(adapter, { onRecovery: async () => { throw new Error('terminated status journal'); } }))).rejects.toThrow('status journal');
    expect(calls).toBe(1);
    const beforeRequest = vi.fn(async () => { throw new Error('terminated authorization'); });
    await expect(collect(request(adapter, { beforeRequest }))).rejects.toThrow('authorization'); expect(calls).toBe(1);
  });
  it('drops incomplete tool calls from retry messages and preserves the committed history', async () => {
    const seen: any[] = []; let calls = 0; const reset = vi.fn();
    const adapter = { async *stream(m: any) { seen.push(structuredClone(m)); if (++calls === 1) {
      yield { type: 'text', delta: 'visible partial' }; yield { type: 'tool_use', id: 'unexecuted', name: 'write', input: {} }; throw new Error('terminated'); }
      yield { type: 'text', delta: ' continuation' }; yield { type: 'done' };
    } };
    await collect(request(adapter, { onRecovery: reset }));
    expect(reset).toHaveBeenCalledOnce(); expect(seen[1][0]).toEqual(seen[0][0]);
    expect(JSON.stringify(seen[1])).toContain('visible partial'); expect(JSON.stringify(seen[1])).not.toContain('unexecuted');
  });
  it.each([401, 403])('does not retry permanent %s errors wrapped in terminated', async status => {
    let calls = 0; const e = Object.assign(new Error('terminated'), { cause: { status } });
    await expect(collect(request({ async *stream() { calls++; throw e; } }))).rejects.toBe(e); expect(calls).toBe(1);
  });
  it('aborts a stuck provider at the absolute deadline', async () => {
    const signals: AbortSignal[] = []; let calls = 0;
    await expect(collect(request({ async *stream(_m: any, _t: any, _s: any, o: any) { calls++; signals.push(o.signal); await new Promise(() => {}); } },
      { deadline: Date.now() + 20, policy: { ...policy, idleMs: 1000 } }))).rejects.toThrow('desktop_tool_loop_deadline_exceeded');
    expect(calls).toBe(1); expect(signals[0].aborted).toBe(true);
  });
  it('cancels recovery backoff immediately with the caller reason', async () => {
    const ctl = new AbortController(), reason = new DOMException('user stop', 'AbortError'); let calls = 0;
    await expect(collect(request({ async *stream() { calls++; throw new Error('terminated'); } }, {
      options: { signal: ctl.signal }, onRecovery: () => ctl.abort(reason), policy: { ...policy, initialDelayMs: 1000 },
    }))).rejects.toBe(reason); expect(calls).toBe(1);
  });
});

it('recovers idle model reads and ignores abandoned output', async () => {
  let calls = 0; const signals: AbortSignal[] = [];
  const out = await collect(request({ async *stream(_m: any, _t: any, _s: any, o: any) {
    signals.push(o.signal); if (++calls === 1) await new Promise(() => {});
    yield { type: 'text', delta: 'healthy' }; yield { type: 'done' };
  } }));
  expect(calls).toBe(2); expect(signals[0].aborted).toBe(true); expect(out.some(x => x.delta === 'healthy')).toBe(true);
});
it('keeps tools disabled when recovering an eligible child summary', async () => {
  const tools: any[] = []; let calls = 0;
  await collect(request({ async *stream(_m: any, t: any) {
    tools.push(t); if (++calls === 1) { yield { type: 'text', delta: 'prefix' }; throw new Error('terminated'); }
    yield { type: 'text', delta: 'tail' }; yield { type: 'done' };
  } }, { tools: [{ name: 'write', inputSchema: {} }], canRecover: () => true }));
  expect(tools[0]).toHaveLength(1); expect(tools[1]).toEqual([]);
});
it('does not accept an empty or tool-emitting summary-only recovery', async () => {
  for (const mode of ['empty', 'tool']) {
    await expect(collect(request({ async *stream() {
      if (mode === 'tool') yield { type: 'tool_use', id: 'bad', name: 'write', input: {} };
      yield { type: 'done' };
    } }, { summaryOnly: true }))).rejects.toThrow(/summary_recovery/);
  }
});
