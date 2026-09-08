import { expect, test, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOpenAIToolProtocol } from '../../../tests/support/openai-tool-protocol';

for (const withFile of [false, true]) test(`homepage ${withFile ? 'attachment' : 'text'} first submission binds both real children to the visible thread`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-welcome-agents-'));
  mkdirSync(join(root, 'workspace'));
  let rootCalls = 0, childCalls = 0;
  const errors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assertOpenAIToolProtocol(body.messages);
      const child = body.messages.some((m: any) => m.role === 'system' && String(m.content).includes('Assigned Desktop agent:'));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({
        id: 'welcome', object: 'chat.completion.chunk', created: 1, model: 'e2e-model',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`);
      if (!child && ++rootCalls === 1) {
        send({ tool_calls: ['first', 'second'].map((name, index) => ({ index, id: `spawn-${name}`,
          type: 'function', function: { name: 'spawn_agent', arguments: JSON.stringify({ task_name: name, message: 'Reply briefly.' }) } })) });
        send({}, 'tool_calls');
      } else {
        if (child) childCalls++;
        send({ content: child ? 'CHILD_DONE' : 'ROOT_DONE' }); send({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = await electron.launch({ args: [join(process.cwd(), 'tests/e2e/fixtures/multi-agent-electron-main.mjs')],
    env: { ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'),
      XIAOK_E2E_USER_DATA: join(root, 'profile'), XIAOK_MULTI_AGENT_E2E_ROOT: root,
      XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    const input = page.locator('textarea').first(); await expect(input).toBeVisible();
    if (withFile) {
      const filePath = join(root, 'workspace', 'brief.txt');
      writeFileSync(filePath, 'Two independent brief checks.');
      // Only the native picker selection is controlled; import and creation
      // still cross the real preload/IPC/material/service boundaries.
      await app.evaluate(({ dialog }, selected) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
      }, filePath);
      await page.getByRole('button', { name: '添加附件', exact: true }).click();
      await expect(page.getByText('brief.txt', { exact: true })).toBeVisible();
    }
    if (withFile) {
      await input.fill('Delegate two independent brief checks.');
    } else {
      await page.getByRole('button', { name: '调用两个子任务，协作制定产品发布计划', exact: true }).click();
      await expect(input).toHaveValue(/spawn_agent/);
      await expect(input).toHaveValue(/wait_agent/);
      expect(new URL(page.url()).hash).not.toMatch(/^#\/t\//);
      expect(rootCalls).toBe(0);
      const bounds = await page.getByRole('button', { name: '调用两个子任务，协作制定产品发布计划', exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
      await page.screenshot({ path: join(root, 'welcome-subagent-prompt.png') });
    }
    await input.press('Enter');
    await expect(page).toHaveURL(/#\/t\//);
    const threadId = new URL(page.url()).hash.slice('#/t/'.length);
    await expect.poll(() => childCalls).toBe(2);
    const snapshot = () => page.evaluate(id => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: id }), threadId);
    // The wire page includes its root row; count children, not all actors.
    await expect.poll(async () => (await snapshot()).agents.filter(agent => agent.parentId !== null).length).toBe(2);
    const current = await snapshot();
    expect(current.group?.threadId).toBe(threadId);
    const task = JSON.parse(readFileSync(join(root, 'data', 'tasks', 'snapshots', `${current.root!.sourceTaskId}.json`), 'utf8'));
    expect(task.context.threadId).toBe(threadId);
    if (withFile) expect(task.materials.length).toBeGreaterThan(0);
    await expect(page.getByRole('tab', { name: 'SubAgent', exact: true })).toBeVisible();
    await expect(page.getByTestId('chat-right-panel')).toHaveCount(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: join(root, 'welcome-agents.png') });
  } finally {
    await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    console.log(`WELCOME_AGENTS_EVIDENCE=${root}`);
  }
});
