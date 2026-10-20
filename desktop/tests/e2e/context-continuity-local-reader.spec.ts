import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

for (const reader of ['resolve_context_reference','search_history'] as const) test(`a real root scoped ${reader} settles locally and admits the next conversation turn`, async ({}, info) => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-local-reader-ui-'));
  mkdirSync(join(root, 'workspace'));
  const calls: Array<{ phase: string; toolResult: boolean }> = [], errors: string[] = [];
  let reference = '', searchRef='', app: ElectronApplication | undefined, pid: number | undefined;
  const server = createServer(async (request, response) => {
    try {
      const bytes: Buffer[] = []; for await (const chunk of request) bytes.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(bytes).toString());
      const user = body.messages.filter((message: { role: string }) => message.role === 'user').map((message: { content: unknown }) => JSON.stringify(message.content)).join('\n');
      const phase = user.includes('NEXT_CLEAN_TURN') ? 'next' : user.includes('READ_FROZEN_REFERENCE') ? 'read' : 'source';
      const toolResult = body.messages.some((message: { role: string; tool_call_id?: string }) => message.role === 'tool' && message.tool_call_id === 'local-history-read');
      calls.push({ phase, toolResult });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'local-history', object: 'chat.completion.chunk', created: 1,
        model: 'e2e-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      if (phase === 'read' && !toolResult) {
        if (!body.tools.some((tool: { function?: { name: string } }) => tool.function?.name === reader)) throw new Error(`actual root ${reader} is absent`);
        send({ tool_calls: [{ index: 0, id: 'local-history-read', type: 'function', function: { name: reader, arguments: JSON.stringify(reader==='search_history'?{query:'LOCAL_HISTORY_SOURCE'}:{ refId: reference }) } }] });
        send({}, 'tool_calls');
      } else {
        if (phase === 'read' && !JSON.stringify(body.messages.filter((message: { role: string }) => message.role === 'tool')).includes('LOCAL_HISTORY_SOURCE')) throw new Error('actual resolver did not return source evidence');
        if(reader==='search_history'&&phase==='read'){
          const actual=body.messages.find((message:{role:string;tool_call_id?:string})=>message.role==='tool'&&message.tool_call_id==='local-history-read');
          const result=JSON.parse(actual.content);searchRef=result.hits[0]?.refId;
          if(!/^[A-Za-z0-9_-]{32}$/.test(searchRef))throw new Error('actual search returned no exact ref');
        }
        send({ content: phase === 'source' ? 'LOCAL_HISTORY_SOURCE' : phase === 'read' ? `READ_COMPLETE${searchRef?` xiaok://context/v1/${searchRef}`:''}` : 'NEXT_TURN_COMPLETE' }); send({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); if (!response.headersSent) response.writeHead(400); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    app = await electron.launch({ args: [join(process.cwd(), 'tests/e2e/fixtures/multi-agent-electron-main.mjs')], env: {
      ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'),
      XIAOK_MULTI_AGENT_E2E_ROOT: root, XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      XIAOK_E2E_BACKGROUND: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    } });
    pid = app.process().pid;
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('textarea').first()).toBeVisible();
    const source = await page.evaluate(async () => {
      const conversation = await window.xiaokDesktop.createContextConversation({ operationId: crypto.randomUUID(), title: 'source' });
      const task = await window.xiaokDesktop.createTask({ prompt: 'BUILD_SOURCE_EVIDENCE', materials: [], context: { threadId: conversation.id } });
      return { conversation, task };
    });
    const hasReceipt = (taskId: string) => app!.evaluate((_electron, id) => {
      const p = (globalThis as any).multiAgentE2E.getServices().continuity.port();
      return Boolean(p.service.store.db.prepare('select 1 from effect_owner_receipts where task_id=?').get(id));
    }, taskId);
    await expect.poll(() => hasReceipt(source.task.taskId)).toBe(true);
    const bound = await page.evaluate(async ({ conversationId,reader }) => {
      const current = await window.xiaokDesktop.listContextConversations();
      const source = current.find(value => value.id === conversationId)!;
      const ref = await window.xiaokDesktop.createContextReference({ operationId: crypto.randomUUID(), conversationId, expectedRevision: source.revision });
      const target = await window.xiaokDesktop.createContextConversation({ operationId: crypto.randomUUID(), title: 'target' });
      if(reader==='search_history')await window.xiaokDesktop.setHistorySearchConsent({conversationId:target.id,enabled:true});
      else await window.xiaokDesktop.attachContextReference({ operationId: crypto.randomUUID(), refId: ref.refId, targetConversationId: target.id });
      return { refId: ref.refId, targetId: target.id };
    }, { conversationId: source.conversation.id,reader });
    reference = bound.refId;
    if(reader==='search_history'){
      await page.evaluate(id=>{window.location.hash=`#/t/${encodeURIComponent(id)}`;},bound.targetId);
      await page.getByRole('button',{name:'搜索聊天历史',exact:true}).click();
      const panel=page.getByRole('region',{name:'搜索聊天历史'});
      await panel.getByRole('textbox',{name:'历史关键词'}).fill('LOCAL_HISTORY_SOURCE');
      await panel.getByRole('button',{name:'搜索',exact:true}).click();
      await expect(panel.getByText('LOCAL_HISTORY_SOURCE',{exact:true})).toBeVisible();
      const consent=panel.getByRole('checkbox',{name:'允许本会话的 Agent 检索我的私人聊天历史'});
      await expect(consent).toBeChecked();await consent.uncheck();
      await expect.poll(()=>page.evaluate(id=>window.xiaokDesktop.getHistorySearchConsent({conversationId:id}),bound.targetId)).toMatchObject({enabled:false});
      await consent.check();await expect.poll(()=>page.evaluate(id=>window.xiaokDesktop.getHistorySearchConsent({conversationId:id}),bound.targetId)).toMatchObject({enabled:true});
      await expect(consent).toBeEnabled();
      await page.screenshot({path:info.outputPath('history-search-wide.png')});
      await page.setViewportSize({width:760,height:850});await page.screenshot({path:info.outputPath('history-search-narrow.png')});
      await page.setViewportSize({width:1440,height:960});
      await panel.getByRole('button',{name:'关闭历史搜索'}).click();
    }
    const target = await page.evaluate(threadId => window.xiaokDesktop.createTask({ prompt: 'READ_FROZEN_REFERENCE', materials: [], context: { threadId } }), bound.targetId);
    await expect.poll(async () => (await page.evaluate(id => window.xiaokDesktop.recoverTask(id), target.taskId)).snapshot.hostDelivery?.hostSettlement).toBe('committed');
    const unknown = await app.evaluate((_electron, id) => (globalThis as any).multiAgentE2E.getServices().continuity.port().service.store.db
      .prepare('select invocation_id,tool_name from unproven_effects where task_id=?').all(id), target.taskId);
    expect(unknown).toEqual([]);
    await expect.poll(() => hasReceipt(target.taskId)).toBe(true);
    if(reader==='search_history'){
      // The task was created through preload, outside ChatShell's submit state;
      // reload the actual persisted history before checking its rendered card.
      await page.reload();
      await expect(page.getByRole('button',{name:'保留此引用授权'})).toBeVisible();
      const currentGrant=()=>page.evaluate(({refId,targetConversationId})=>window.xiaokDesktop.getContextGrant({refId,targetConversationId}),{refId:searchRef,targetConversationId:bound.targetId});
      await expect.poll(currentGrant).toMatchObject({basis:'history_search'});
      await page.getByRole('button',{name:'保留此引用授权'}).click();
      await expect.poll(currentGrant).toMatchObject({basis:'explicit'});
      await expect(page.getByRole('button',{name:'保留此引用授权'})).toHaveCount(0);
      await page.screenshot({path:info.outputPath('search-grant-preserved.png')});
      await page.getByRole('button',{name:'搜索聊天历史',exact:true}).click();
      const consent=page.getByRole('region',{name:'搜索聊天历史'}).getByRole('checkbox',{name:'允许本会话的 Agent 检索我的私人聊天历史'});
      await expect(consent).toBeChecked();await consent.uncheck();
      await expect.poll(()=>page.evaluate(id=>window.xiaokDesktop.getHistorySearchConsent({conversationId:id}),bound.targetId)).toMatchObject({enabled:false});
      await expect.poll(currentGrant).toMatchObject({basis:'explicit'});
      await page.getByRole('button',{name:'关闭历史搜索'}).click();
    }
    const next = await page.evaluate(threadId => window.xiaokDesktop.createTask({ prompt: 'NEXT_CLEAN_TURN', materials: [], context: { threadId } }), bound.targetId);
    await expect.poll(() => hasReceipt(next.taskId)).toBe(true);
    expect(calls.some(call => call.phase === 'read' && call.toolResult)).toBe(true);
    expect(calls.some(call => call.phase === 'next')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app?.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    let reaped = pid === undefined; if (pid) { try { process.kill(pid, 0); } catch { reaped = true; } }
    try { writeFileSync(info.outputPath('electron.log'), readFileSync(join(root, 'electron.log'))); } catch { /* Own fixture only. */ }
    writeFileSync(info.outputPath('run.json'), JSON.stringify({ pid, reaped, calls, errors, browserFallback: 'Browser plugin unavailable; actual Playwright Electron' }, null, 2));
    rmSync(root, { recursive: true, force: true, maxRetries: 3 }); expect(reaped).toBe(true);
  }
});
