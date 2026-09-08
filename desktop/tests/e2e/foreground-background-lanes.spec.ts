import { expect, test, _electron as electron } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOpenAIToolProtocol } from '../../../tests/support/openai-tool-protocol';

test('held background model does not prevent homepage foreground from spawning and waiting for two children', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-execution-lanes-e2e-'));
  mkdirSync(join(root, 'workspace'));
  let held: ServerResponse | undefined;
  let heldForeground: ServerResponse | undefined;
  let rootCalls = 0, childCalls = 0;
  const errors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assertOpenAIToolProtocol(body.messages);
      if (JSON.stringify(body.messages).includes('BACKGROUND_HELD_SENTINEL')) { held = response; return; }
      if (JSON.stringify(body.messages).includes('FOREGROUND_BLOCKER_SENTINEL')) { heldForeground = response; return; }
      const child = body.messages.some((m: any) => m.role === 'system' && String(m.content).includes('Assigned Desktop agent:'));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({
        id: 'lanes', object: 'chat.completion.chunk', created: 1, model: 'e2e-model',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`);
      if (!child && ++rootCalls === 1) {
        send({ tool_calls: ['first', 'second'].map((name, index) => ({ index, id: `spawn-${name}`, type: 'function',
          function: { name: 'spawn_agent', arguments: JSON.stringify({ task_name: name, message: 'Reply 42.' }) } })) });
        send({}, 'tool_calls');
      } else if (!child && rootCalls === 2) {
        send({ tool_calls: [{ index: 0, id: 'wait-children', type: 'function', function: {
          name: 'wait_agent', arguments: JSON.stringify({ timeout_ms: 10000 }),
        } }] }); send({}, 'tool_calls');
      } else {
        if (child) childCalls++;
        send({ content: child ? 'CHILD_42' : 'FOREGROUND_COMPLETED_WITH_BACKGROUND_HELD' }); send({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = await electron.launch({ args: [join(process.cwd(), 'tests/e2e/fixtures/multi-agent-electron-main.mjs')],
    env: { ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'),
      XIAOK_MULTI_AGENT_E2E_ROOT: root, XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('textarea').first()).toBeVisible();
    const bg = await app.evaluate(async () => (globalThis as any).multiAgentE2E.getServices().createBackgroundTask({
      prompt: 'BACKGROUND_HELD_SENTINEL', materials: [],
    }));
    await expect.poll(() => Boolean(held)).toBe(true);
    await app.evaluate(async () => (globalThis as any).multiAgentE2E.getServices().createTask({
      prompt: 'FOREGROUND_BLOCKER_SENTINEL', materials: [],
    }));
    await expect.poll(() => Boolean(heldForeground)).toBe(true);
    const input = page.locator('textarea').first();
    await input.fill('请调用两个子任务分别计算 17+25 和 6*7，等待结果并汇总。'); await input.press('Enter');
    await expect(page.locator('.chat-right-main').getByText(/排队中，等待可用执行槽位/)).toBeVisible();
    await page.screenshot({ path: join(root, 'foreground-queued.png') });
    heldForeground!.writeHead(200, { 'content-type': 'text/event-stream' });
    heldForeground!.end(`data: ${JSON.stringify({ id: 'release', object: 'chat.completion.chunk', created: 1,
      model: 'e2e-model', choices: [{ index: 0, delta: { content: 'BLOCKER_DONE' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    await expect(page.locator('.chat-right-main').getByText('FOREGROUND_COMPLETED_WITH_BACKGROUND_HELD', { exact: true })).toBeVisible();
    expect(childCalls).toBe(2); expect(rootCalls).toBe(3);
    const snapshot = await app.evaluate(async (_electron, taskId) =>
      (globalThis as any).multiAgentE2E.getServices().recoverTask(taskId), bg.taskId);
    expect(snapshot.snapshot.status).toBe('running');
    expect(held?.writableEnded).toBe(false);
    await expect(page.locator('.chat-right-main').getByText('Thinking...', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(root, 'foreground-complete-background-held.png') });
    expect(errors).toEqual([]);
    await app.evaluate(async (_electron, taskId) => (globalThis as any).multiAgentE2E.getServices().cancelTask(taskId), bg.taskId);
  } finally {
    held?.destroy(); heldForeground?.destroy(); await app.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
