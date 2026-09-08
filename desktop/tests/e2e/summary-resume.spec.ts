import { expect, test, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOpenAIToolProtocol } from '../../../tests/support/openai-tool-protocol';

test('two completed children survive a real summary socket disconnect without respawn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-summary-resume-e2e-')); mkdirSync(join(root, 'workspace'));
  let roots = 0, children = 0, recovery = false;
  const errors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const c of request) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString()); assertOpenAIToolProtocol(body.messages);
      const child = body.messages.some((m: any) => m.role === 'system' && String(m.content).includes('Assigned Desktop agent:'));
      const results = body.messages.filter((m: any) => m.role === 'tool').flatMap((m: any) => {
        try { return [JSON.parse(m.content)]; } catch { return []; }
      });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'usage', object: 'chat.completion.chunk', created: 1, model: 'e2e-model', choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\n`);
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'resume',
        object: 'chat.completion.chunk', created: 1, model: 'e2e-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if (child) { children++; send({ content: '已完成子任务规划。' }, 'stop'); }
      else if (++roots === 1) {
        send({ tool_calls: ['positioning', 'launch'].map((task_name, index) => ({ index, id: `spawn-${index}`, type: 'function',
          function: { name: 'spawn_agent', arguments: JSON.stringify({ task_name, message: 'Return a brief plan.' }) } })) }, 'tool_calls');
      } else if (roots === 2) {
        const spawned = results.filter((r: any) => r.targetAgentId);
        expect(spawned.map((r: any) => r.displayNames.zh)).toEqual(['双鱼座', '天秤座']);
        send({ tool_calls: [{ index: 0, id: 'wait-both', type: 'function', function: { name: 'wait_agent',
          arguments: JSON.stringify({ targets: spawned.map((r: any) => r.targetAgentId), timeout_ms: 1000 }) } }] }, 'tool_calls');
      } else if (roots === 3) {
        send({ content: '双鱼座和天秤座均已完成。发布计划：' });
        // A real transport truncation after flushed text, not an adapter mock.
        setTimeout(() => response.destroy(), 100); return;
      } else {
        expect(roots).toBe(4); expect(body.tools ?? []).toEqual([]);
        expect(JSON.stringify(body.messages)).toContain('双鱼座和天秤座均已完成。发布计划：');
        expect(results.filter((r: any) => r.targetAgentId)).toHaveLength(2);
        recovery = true;
        send({ content: '第一周验证定位，第二周小规模推广。SUMMARY_RECOVERED' }, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); response.destroy(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = await electron.launch({ args: [join(process.cwd(), 'tests/e2e/fixtures/multi-agent-electron-main.mjs')], env: {
    ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'),
    XIAOK_MULTI_AGENT_E2E_ROOT: root, XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  } });
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    const input = page.locator('textarea').first(); await expect(input).toBeVisible();
    await input.fill('请并行派出两个子任务规划产品定位和推广，再汇总。'); await input.press('Enter');
    await expect(page.locator('.chat-right-main').getByText(/SUMMARY_RECOVERED/)).toBeVisible();
    const threadId = new URL(page.url()).hash.split('/').at(-1)!;
    await expect.poll(async () => (await page.evaluate(threadId => window.xiaokDesktop.getMultiAgentSnapshot({ threadId }), threadId)).root?.status).toBe('completed');
    const final = await page.evaluate(threadId => window.xiaokDesktop.getMultiAgentSnapshot({ threadId }), threadId);
    expect(final.root?.usage).toEqual({ inputTokens: 40, outputTokens: 4 });
    expect(roots).toBe(4); expect(children).toBe(2); expect(recovery).toBe(true); expect(errors).toEqual([]);
    await page.screenshot({ path: join(root, 'summary-recovered.png') });
    console.log(`SUMMARY_RESUME_EVIDENCE=${root}`);
  } finally { await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
