import { describe, expect, it, vi } from 'vitest';
import { EmbeddedYZJChannel } from '../../src/channels/embedded-yzj.js';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';

// 场景：终端里的用户正在跑一轮任务，同时云之家里有一条消息触发了另一轮（channel turn）。
// 期望：终端那一轮的工具确认只由终端决定，不推给云之家用户，云之家用户的 /approve 也批准不了它。
describe('QA: 终端 turn 与 channel turn 并发时确认不得跨主体', () => {
  it('终端 turn 的确认不推送给 channel 用户，且 channel 用户 /approve 不能批准它', async () => {
    const pushed: string[] = [];
    const approvalStore = new InMemoryApprovalStore();
    let releaseChannelTurn!: () => void;
    const facade = { runTurn: vi.fn(() => new Promise<void>((r) => { releaseChannelTurn = r; })) } as any;
    const transport = { deliver: vi.fn(async (m: any) => { pushed.push(m.text); }) };
    const ch = new EmbeddedYZJChannel({
      runtimeFacade: facade, runtimeHooks: createRuntimeHooks(), approvalStore,
      transport: transport as any, selectedChannel: { name: 'c', robotId: 'r' } as any,
      yzjConfig: { webhookUrl: 'https://example.invalid/w', inboundMode: 'websocket', webhookPath: '/w', webhookPort: 1, secret: undefined } as any,
      allowedSenders: ['remote_user'], sessionId: 's', cwd: '/ws', approvalTimeoutMs: 2000,
    });
    // channel 用户发起一轮并保持运行
    const inbound = ch.handleInboundForTest({ robotId: 'r', content: 'hi', operatorOpenid: 'remote_user', msgId: 'm1', operatorName: 'x', robotName: 'b' } as any);
    await new Promise((r) => setTimeout(r, 20));
    // 此时终端里（另一轮）触发了一次工具确认；终端用户还没有回答
    let terminalAnswered!: (v: boolean) => void;
    const tui = vi.fn(() => new Promise<boolean>((r) => { terminalAnswered = r; }));
    const decision = ch.makeOnPrompt(tui)('bash', { command: 'echo terminal-only-op' });
    await new Promise((r) => setTimeout(r, 50));
    const leaked = pushed.filter((t) => t.includes('bash') || t.includes('terminal-only-op'));
    expect(leaked).toEqual([]);                       // 期望：没有推送给 channel
    const id = /approve\s+(\S+)/.exec(pushed.join('\n'))?.[1];
    if (id) {
      await ch.handleInboundForTest({ robotId: 'r', content: `/approve ${id}`, operatorOpenid: 'remote_user', msgId: 'm2', operatorName: 'x', robotName: 'b' } as any);
    }
    const result = await Promise.race([decision, new Promise((r) => setTimeout(() => r('pending'), 100))]);
    expect(result).toBe('pending');                   // 期望：终端用户没答之前，不能被远程批准
    terminalAnswered(false); releaseChannelTurn(); await inbound;
  });
});
