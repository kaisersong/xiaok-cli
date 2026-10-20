import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('fixed references: actual IPC, grants, resolver and unknown-effect deletion gate across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-continuity-electron-')); mkdirSync(join(root, 'workspace'));
  const errors: string[] = [], calls: unknown[] = []; let sawAuthorizedTool = false;
  const server = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
      const body = JSON.parse(Buffer.concat(parts).toString()); calls.push(body);
      const messages = body.messages as Array<{ role: string; content: unknown }>;
      const lastUser = messages.findLastIndex(message => message.role === 'user');
      const user = JSON.stringify(messages[lastUser]?.content);
      const latestTools = messages.slice(lastUser + 1).filter(message => message.role === 'tool');
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: unknown, finish: string) => response.write(`data: ${JSON.stringify({ id: 'continuity-e2e', object: 'chat.completion.chunk', created: 1, model: 'e2e-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      const refId = /xiaok:\/\/context\/v1\/([A-Za-z0-9_-]{32})/.exec(user)?.[1];
      if (latestTools.length) {
        expect(JSON.stringify(latestTools)).toContain('REFERENCE_SOURCE_ANSWER'); sawAuthorizedTool = true;
        send({ content: 'AUTHORIZED_REFERENCE_ANSWER' }, 'stop');
      } else if (refId) {
        expect(body.tools.some((tool: any) => tool.function.name === 'resolve_context_reference')).toBe(true);
        send({ tool_calls: [{ index: 0, id: 'read-fixed-reference', type: 'function', function: { name: 'resolve_context_reference', arguments: JSON.stringify({ refId }) } }] }, 'tool_calls');
      } else send({ content: user.includes('SOURCE_FOLLOWUP') ? 'SOURCE_LATER_ANSWER' : 'REFERENCE_SOURCE_ANSWER' }, 'stop');
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); response.destroy(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const launchOptions = { args: [join(process.cwd(), 'tests/e2e/fixtures/multi-agent-electron-main.mjs')], env: {
    ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'),
    XIAOK_MULTI_AGENT_E2E_ROOT: root, XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  } };
  let app: ElectronApplication | undefined; const ownedPids:number[]=[];
  const launch=async()=>{const value=await electron.launch(launchOptions);ownedPids.push(value.process().pid!);writeFileSync(join(root,'owned-electron-pids.json'),JSON.stringify(ownedPids));return value;};
  try {
    app = await launch(); let page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('textarea').first().fill('REFERENCE_SOURCE_INPUT'); await page.locator('textarea').first().press('Enter');
    await expect(page.locator('.chat-right-main').getByText('REFERENCE_SOURCE_ANSWER', { exact: true })).toBeVisible();
    const sourceId = new URL(page.url()).hash.split('/').at(-1)!;
    await page.locator('[data-context-source]').filter({ hasText: 'REFERENCE_SOURCE_ANSWER' }).last().getByRole('button', { name: '复制消息引用', exact: true }).click();
    await expect(page.getByText('已复制引用', { exact: true })).toBeVisible();
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^xiaok:\/\/context\/v1\/[A-Za-z0-9_-]{32}$/);
    const url = await app.evaluate(({ clipboard }) => clipboard.readText());
    const refId = url.split('/').at(-1)!;
    expect((await page.evaluate(refId => window.xiaokDesktop.resolveContextReference({ refId }), refId)).messages.map(message => message.text)).toEqual(['REFERENCE_SOURCE_ANSWER']);
    const target = await page.evaluate(() => window.xiaokDesktop.createContextConversation({ operationId: crypto.randomUUID(), title: 'Reference target' }));
    await page.evaluate(id => { location.hash = `#/t/${id}`; }, target.id);
    const input = page.locator('textarea').first(); await input.fill(url);
    const draft = page.getByRole('complementary', { name: '历史引用' }).last();
    await draft.getByRole('button', { name: '展开引用' }).click();
    await expect(draft.getByText('REFERENCE_SOURCE_ANSWER', { exact: true })).toBeVisible();
    expect(await page.evaluate(({ refId, id }) => window.xiaokDesktop.getContextGrant({ refId, targetConversationId: id }), { refId, id: target.id })).toBeNull();
    await draft.getByRole('button', { name: '允许当前会话读取' }).click();
    await expect(draft.getByRole('button', { name: '撤销当前授权' })).toBeVisible();
    await page.screenshot({ path: join(root, 'reference-authorized.png') });
    await input.press('Enter');
    await expect(page.locator('.chat-right-main').getByText('AUTHORIZED_REFERENCE_ANSWER', { exact: true })).toBeVisible(); expect(sawAuthorizedTool).toBe(true);
    await page.reload();
    const card = page.getByRole('complementary', { name: '历史引用' }).first();
    await expect(card.getByRole('button', { name: '撤销当前授权' })).toBeVisible();
    await card.getByRole('button', { name: '展开引用' }).click();
    await expect(card.getByRole('link', { name: '前往原消息' })).toHaveAttribute('href', new RegExp(`/t/${sourceId}\\?sourceTask=`));
    await card.getByRole('button',{name:'连接外部 Agent'}).click();
    await card.getByRole('button',{name:'生成一次性 MCP 配置'}).click();
    const configBox=card.getByRole('textbox',{name:'一次性 MCP 配置'});await expect(configBox).toBeVisible();
    const firstConfig=JSON.parse(await configBox.inputValue()).mcpServers['xiaok-context'];
    await card.getByRole('button',{name:'复制 MCP 配置'}).click();
    await expect.poll(async()=>(await app!.evaluate(({clipboard})=>clipboard.readText()))===(await configBox.inputValue())).toBe(true);
    const externalRead=(config:{url:string;headers:Record<string,string>})=>fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'resolve_context_reference',arguments:{refId}}})});
    const external=await externalRead(firstConfig);expect(external.status).toBe(200);expect(await external.text()).toContain('REFERENCE_SOURCE_ANSWER');
    expect(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('Bearer ')))).toBe(false);
    await card.getByRole('button',{name:'撤销外部读取凭证'}).click();await expect(card.getByRole('button',{name:'撤销外部读取凭证'})).toHaveCount(0);
    expect((await externalRead(firstConfig)).status).toBe(401);
    await card.getByRole('button',{name:'生成一次性 MCP 配置'}).click();await expect(configBox).toBeVisible();const persistentConfig=JSON.parse(await configBox.inputValue()).mcpServers['xiaok-context'];
    await card.getByRole('button',{name:'连接外部 Agent'}).click();await expect(configBox).toHaveCount(0);
    const source = await page.evaluate(id => window.xiaokDesktop.getContextConversation({ conversationId: id }), sourceId);
    const later = await page.evaluate(({ id, tasks }) => window.xiaokDesktop.createTask({ prompt: 'SOURCE_FOLLOWUP', materials: [], context: { threadId: id, taskIds: tasks } }), { id: sourceId, tasks: source!.taskIds });
    await expect.poll(() => page.evaluate(async id => (await window.xiaokDesktop.recoverTask(id)).snapshot.status, later.taskId)).toBe('completed');
    await expect.poll(async () => (await page.evaluate(({ refId }) => window.xiaokDesktop.resolveContextReference({ refId }), { refId })).messages.map(message => message.text)).toEqual(['REFERENCE_SOURCE_ANSWER']);
    await app.evaluate(async (_electron, id) => {
      const services = (globalThis as any).multiAgentE2E.getServices(), m = services.multiAgent;
      const access = m.service.createUserAccess({ requestSource: 'user', actorId: `desktop-user:${m.profileId}`, profileId: m.profileId, workspaceId: m.workspaceId, threadId: id });
      const state = m.service.readThreadDeletion({ access });
      const result = await m.service.deleteThread({ access, requestSource: 'user', operationId: `delete:${state.threadRevision}:owner_only_delete`, expectedThreadRevision: state.threadRevision, confirmTerminate: true });
      // The unqualified resolver tool has an unknown effect closure. No tool
      // Promise, normal turn completion or restart may declare deletion done.
      if (result.state === 'completed') throw new Error('unknown effect incorrectly completed deletion');
      if(services.continuity.port().service.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(id)?.deleted!==0)throw new Error('unknown effect tombstoned canonical content');
    }, sourceId);
    await app.close(); app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('textarea').first()).toBeVisible();
    const denied = await page.evaluate(async refId => { try { await window.xiaokDesktop.resolveContextReference({ refId }); return false; } catch { return true; } }, refId);
    expect(denied).toBe(true); // pending deletion remains blocked; it has not completed
    const mcpStatus=await page.evaluate(()=>window.xiaokDesktop.getContextMcpStatus());expect(mcpStatus.url).toBe(persistentConfig.url);
    expect((await externalRead(persistentConfig)).status).toBe(401);
    await page.screenshot({ path: join(root, 'reference-after-owner-restart.png') });
    expect(errors).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain('Bearer ');
    writeFileSync(join(root, 'result.json'), JSON.stringify({ browser: 'Browser plugin not available; Playwright Electron', root, sourceId, targetId: target.id, sawAuthorizedTool, deletion:'blocked_unknown_effect_not_completed', ownedPids, calls: calls.length, errors }, null, 2));
    console.log(`CONTINUITY_ELECTRON_EVIDENCE=${root}`);
  } finally { await app?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
