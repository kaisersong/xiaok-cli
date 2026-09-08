import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOpenAIToolProtocol } from '../../../tests/support/openai-tool-protocol';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
test('E2: saved result readback fences new turns and shows real UTF-8 truncation after process restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-readback-electron-'));
  mkdirSync(join(root, 'workspace'));
  const milestones: Array<{ stage: string; at: number }> = [];
  const mark = (stage: string) => { milestones.push({ stage, at: Date.now() }); writeFileSync(join(root, 'readback-milestones.json'), JSON.stringify(milestones, null, 2)); };
  const firstText = '甲😀'.repeat(18_000) + 'READBACK_FIRST_FULL_END';
  const secondText = '乙😀'.repeat(14_000) + 'READBACK_SECOND_FULL_END';
  const thirdText = '丙😀'.repeat(300_000) + 'READBACK_THIRD_UNSAVED_END';
  const errors: string[] = [];
  const calls: Array<{ child: boolean; turn: number }> = [];
  let rootCalls = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()); assertOpenAIToolProtocol(body.messages);
      const system = body.messages.filter((message: { role: string }) => message.role === 'system')
        .map((message: { content: string }) => message.content).join('\n');
      const child = system.includes('Assigned Desktop agent:');
      const history = JSON.stringify(body.messages);
      const turn = child ? history.includes('READBACK_REQUEST_THIRD') ? 3 : history.includes('READBACK_REQUEST_SECOND') ? 2 : 1 : 0;
      calls.push({ child, turn });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'readback', object: 'chat.completion.chunk',
        created: 1, model: 'e2e-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if (!child && ++rootCalls === 1) {
        send({ tool_calls: [{ index: 0, id: 'readback-spawn', type: 'function', function: { name: 'spawn_agent',
          arguments: JSON.stringify({ task_name: 'readback', message: 'Return the saved-content fixture.', fork_context: true }) } }] });
        send({}, 'tool_calls');
      } else {
        send({ content: child ? turn === 1 ? firstText : turn === 2 ? secondText : thirdText : 'READBACK_ROOT_DONE' });
        send({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); if (!response.headersSent) response.writeHead(400); response.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  let app: ElectronApplication | undefined;
  try {
    const launchOptions = { args: [join(desktop, 'tests/e2e/fixtures/multi-agent-electron-main.mjs')],
      env: { ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'), XIAOK_MULTI_AGENT_E2E_ROOT: root,
        XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${address.port}/v1`, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } };
    app = await electron.launch(launchOptions);
    let page = await app.firstWindow();
    const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(async () => {
      const request = indexedDB.open('xiaok-desktop', 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('threads')) request.result.createObjectStore('threads', { keyPath: 'id' }); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('threads', 'readwrite');
      tx.objectStore('threads').put({ id: 'readback-thread', title: 'Saved content E2E', status: 'idle', mode: 'chat', createdAt: Date.now(), updatedAt: Date.now(), taskIds: [], currentTaskId: null });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close(); location.hash = '#/t/readback-thread';
    });
    const composer = page.locator('.chat-right-main textarea'); await expect(composer).toBeVisible();
    await composer.fill('Delegate one saved-content readback check.'); await composer.press('Enter');
    const snapshot = () => page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'readback-thread' }));
    await expect.poll(async () => (await snapshot()).agents.find(agent => agent.taskName === 'readback')?.status).toBe('completed');
    const initial = await snapshot(); const groupId = initial.group!.groupId;
    const child = initial.agents.find(agent => agent.taskName === 'readback')!;
    const readButton = () => page.getByRole('button', { name: /读取(?:完整|已保存)内容/ });
    const displayed = () => page.locator('.multi-agent-saved-content pre');
    const savedNoticeIsWithinOutput = () => page.locator('.multi-agent-saved-content').evaluate(node => {
      const output = node.closest('.multi-agent-output')!.getBoundingClientRect();
      const notice = node.querySelector('p[role="status"]')!.getBoundingClientRect();
      const pager = node.querySelector('.multi-agent-content-pager')!.getBoundingClientRect();
      const body = node.querySelector('pre')!.getBoundingClientRect();
      return { noticeVisible: notice.top >= output.top - 1 && notice.bottom <= output.bottom,
        pagerVisible: pager.top >= output.top - 1 && pager.bottom <= output.bottom, bodyStartVisible: body.top < output.bottom };
    });
    const segmentEvidence: Array<{ label: string; segments: number; maxVisibleUnits: number; sha256: string; contentReads: number }> = [];
    const collectSegments = async (wanted: string, label: string, expectedHash = createHash('sha256').update(wanted).digest('hex')) => {
      await expect(displayed()).toHaveCount(1); await expect(readButton()).toBeFocused();
      const beforeReads = await app!.evaluate(() => (globalThis as any).multiAgentE2E.contentReads().length);
      const pieces: string[] = []; const previous = page.getByRole('button', { name: '上一段', exact: true });
      const next = page.getByRole('button', { name: '下一段', exact: true });
      await expect(previous).toHaveAttribute('aria-disabled', 'true');
      const first = await displayed().textContent();
      await previous.press('Enter'); await expect(previous).toBeFocused(); expect(await displayed().textContent()).toBe(first);
      for (let index = 0; index < 257; index++) {
        await expect(displayed()).toHaveCount(1);
        const piece = (await displayed().textContent())!;
        expect(piece.length).toBeLessThanOrEqual(8192); expect(Buffer.from(piece).toString('utf8')).toBe(piece);
        pieces.push(piece);
        if (await next.getAttribute('aria-disabled') === 'true') break;
        await next.click();
      }
      await expect(next).toHaveAttribute('aria-disabled', 'true');
      // Real Chromium native keyboard activation, including both inert edges.
      const last = pieces.at(-1); await next.press('Space'); await expect(next).toBeFocused(); expect(await displayed().textContent()).toBe(last);
      const actual = pieces.join(''); expect(actual).toBe(wanted); expect(createHash('sha256').update(actual).digest('hex')).toBe(expectedHash);
      const afterReads = await app!.evaluate(() => (globalThis as any).multiAgentE2E.contentReads().length);
      expect(afterReads).toBe(beforeReads);
      segmentEvidence.push({ label, segments: pieces.length, maxVisibleUnits: Math.max(...pieces.map(piece => piece.length)), sha256: expectedHash, contentReads: afterReads });
    };
    await readButton().click(); await collectSegments(firstText, 'first');
    mark('first-content-verified');
    // A loaded result must disappear on a real new-turn snapshot. Old timeline
    // chunks remain legitimate history, so inspect only the saved-result view.
    await page.getByLabel('补充说明').fill('READBACK_REQUEST_SECOND');
    await page.getByRole('button', { name: '继续执行', exact: true }).click();
    await expect.poll(async () => (await snapshot()).agents.find(agent => agent.id === child.id)?.turn).toBe(2);
    await expect(displayed()).toHaveCount(0);
    mark('first-content-fenced-on-turn-2');
    await expect.poll(async () => (await snapshot()).agents.find(agent => agent.id === child.id)?.status).toBe('completed');
    const second = (await snapshot()).agents.find(agent => agent.id === child.id)!;
    await app.evaluate(() => (globalThis as any).multiAgentE2E.holdNextContent());
    await readButton().click();
    await expect.poll(async () => app!.evaluate((_electron, contentId) => (globalThis as any).multiAgentE2E.contentReads()
      .filter((read: { contentId: string }) => read.contentId === contentId).length, second.resultContentId)).toBe(1);
    mark('second-page-held');
    // A different same-domain view can use the real semantic API while this
    // view waits for a page. No test writes to the store or renderer projection.
    await page.evaluate(input => window.xiaokDesktop.followupAgent(input), { threadId: 'readback-thread', groupId,
      agentId: child.id, expectedTurn: 2, operationId: 'readback-third', message: 'READBACK_REQUEST_THIRD' });
    await expect.poll(async () => (await snapshot()).agents.find(agent => agent.id === child.id)?.turn).toBe(3);
    mark('third-turn-started');
    await app.evaluate(() => (globalThis as any).multiAgentE2E.releaseContent());
    mark('second-page-released');
    await expect.poll(async () => (await snapshot()).agents.find(agent => agent.id === child.id)?.status).toBe('completed');
    mark('third-turn-completed');
    await expect(displayed()).toHaveCount(0);
    expect(await app.evaluate((_electron, contentId) => (globalThis as any).multiAgentE2E.contentReads()
      .filter((read: { contentId: string }) => read.contentId === contentId).length, second.resultContentId)).toBe(1);
    const third = (await snapshot()).agents.find(agent => agent.id === child.id)!;
    const savedPage = await page.evaluate(input => window.xiaokDesktop.getAgentContent(input), { threadId: 'readback-thread', groupId, contentId: third.resultContentId!, offset: 0 });
    mark('third-saved-metadata');
    expect(savedPage.truncated).toBe(true); expect(savedPage.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    // Independently cut the known fixture at a Unicode scalar boundary, not a
    // test copy of the page reader or production Store truncation algorithm.
    const savedText = '丙😀'.repeat(Math.floor(savedPage.byteLength / 7)) + (savedPage.byteLength % 7 === 3 ? '丙' : '');
    expect(Buffer.byteLength(savedText)).toBe(savedPage.byteLength);
    await readButton().click(); mark('third-read-clicked'); await collectSegments(savedText, 'third', savedPage.sha256);
    mark('third-full-content-verified');
    await expect(page.getByText(/原结果其余部分未保存/)).toBeVisible();
    expect(await savedNoticeIsWithinOutput()).toEqual({ noticeVisible: true, pagerVisible: true, bodyStartVisible: true });
    await expect(page.getByTestId('chat-right-panel')).toHaveCount(1);
    await page.screenshot({ path: join(root, 'saved-truncated.png') });
    mark('third-screenshot');
    const requestCount = calls.length; const oldPid = app.process().pid;
    await app.close(); app = await electron.launch(launchOptions); expect(app.process().pid).not.toBe(oldPid);
    mark('process-restarted');
    page = await app.firstWindow(); page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded'); await page.evaluate(() => { location.hash = '#/t/readback-thread'; });
    await expect(page.locator('.chat-right-main textarea')).toBeVisible();
    await expect(page.locator('.chat-right-entry')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+C');
    await page.getByTestId('chat-right-panel').locator('[role="tab"][id$="agents-tab"]').click();
    await page.getByRole('button', { name: '执行组历史', exact: true }).click();
    await page.locator('.multi-agent-history button').filter({ hasText: groupId.slice(0, 8) }).click();
    await page.locator('.multi-agent-row').filter({ has: page.locator('em.multi-agent-alias') }).click();
    await expect(page.getByText('历史记录，只读', { exact: true })).toBeVisible();
    await readButton().click(); await collectSegments(savedText, 'restarted-history', savedPage.sha256);
    await expect(page.getByText(/原结果其余部分未保存/)).toBeVisible();
    expect(await savedNoticeIsWithinOutput()).toEqual({ noticeVisible: true, pagerVisible: true, bodyStartVisible: true });
    await expect(page.getByRole('button', { name: '继续执行', exact: true })).toBeDisabled();
    await expect(page.getByTestId('chat-right-panel')).toHaveCount(1); expect(calls).toHaveLength(requestCount);
    expect(errors).toEqual([]); expect(pageErrors).toEqual([]);
    await page.screenshot({ path: join(root, 'history-saved-truncated.png') });
    writeFileSync(join(root, 'readback-evidence.json'), JSON.stringify({ calls, savedPage: { ...savedPage, base64: undefined },
      oldPid, newPid: app.process().pid, errors, pageErrors, segmentEvidence }, null, 2));
  } finally {
    const page = app?.windows().at(-1);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(root, 'readback-final-window.png') }).catch(() => {});
      const state = await page.locator('.multi-agent-output pre').evaluateAll(nodes => nodes.map(node => ({ length: node.textContent?.length,
        firstCodePoint: node.textContent?.codePointAt(0), tail: node.textContent?.slice(-32) }))).catch(error => ({ error: String(error) }));
      writeFileSync(join(root, 'readback-rendered-summary.json'), JSON.stringify(state, null, 2));
    }
    writeFileSync(join(root, 'readback-provider.json'), JSON.stringify({ calls, errors }, null, 2));
    await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    console.log(`MULTI_AGENT_READBACK_E2E_EVIDENCE=${root}`);
  }
});

test('E1: actual Electron preload / services / renderer execute and display the child lifecycle over strict SSE', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-multi-agent-electron-')); mkdirSync(join(root, 'workspace'));
  const requests: Array<{ child: boolean; body: any }> = []; const errors: string[] = []; let rootRound = 0; let childRound = 0; let deletionRootRound = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()); assertOpenAIToolProtocol(body.messages);
      const system = body.messages.filter((message: any) => message.role === 'system').map((message: any) => message.content).join('\n');
      const child = system.includes('Assigned Desktop agent:'); requests.push({ child, body });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', created: 1, model: 'e2e-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      const tool = (name: string, input: unknown, id: string) => {
        send({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] });
        const text = JSON.stringify(input); const half = Math.ceil(text.length / 2);
        send({ tool_calls: [{ index: 0, function: { arguments: text.slice(0, half) } }] }); send({ tool_calls: [{ index: 0, function: { arguments: text.slice(half) } }] });
        send({}, 'tool_calls');
      };
      if (child && JSON.stringify(body.messages).includes('E2E_DELETE_CHILD')) { send({ content: 'E2E_DELETE_CHILD_RUNNING' }); return; }
      if (!child && JSON.stringify(body.messages).includes('E2E_DELETE_TEST')) {
        if (++deletionRootRound === 1) tool('spawn_agent', { task_name: 'deletion_review', message: 'E2E_DELETE_CHILD verify cleanup.', fork_context: true }, 'delete-spawn');
        else { send({ content: 'E2E_DELETE_ROOT_DONE' }); send({}, 'stop'); }
        response.end('data: [DONE]\n\n'); return;
      }
      if (child && JSON.stringify(body.messages).includes('E2E_STALL')) { send({ content: 'E2E_WAITING_FOR_INTERRUPT' }); return; }
      if (child && JSON.stringify(body.messages).includes('E2E_FOLLOWUP')) { send({ content: 'E2E_FOLLOWUP_DONE' }); send({}, 'stop'); }
      else if (child) {
        if (++childRound === 1) tool('send_message', { target: 'main', message: 'E2E_CHILD_READY' }, 'child-send');
        else { send({ content: 'E2E_CHILD_DONE' }); send({}, 'stop'); }
      } else if (++rootRound === 1) tool('spawn_agent', { task_name: 'review', message: 'Verify E2E protocol and send E2E_CHILD_READY to main.', fork_context: true }, 'root-spawn');
      else if (rootRound === 2) {
        const result = body.messages.find((message: any) => message.role === 'tool' && message.tool_call_id === 'root-spawn');
        const childId = JSON.parse(result.content).targetAgentId;
        tool('wait_agent', { targets: [childId], timeout_ms: 1000 }, 'root-wait');
      } else if (rootRound === 3) tool('report_progress', { steps: [{ id: 'verify', label: 'E2E_EXISTING_TASK_PANEL', status: 'completed' }] }, 'root-progress');
      else { send({ content: 'E2E_ROOT_DONE' }); send({}, 'stop'); }
      response.write(`data: ${JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch (error) { errors.push(String(error)); response.writeHead(400); response.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number };
  let app: ElectronApplication | undefined;
  try {
    const launchOptions = { args: [join(desktop, 'tests/e2e/fixtures/multi-agent-electron-main.mjs')],
      env: { ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'), XIAOK_MULTI_AGENT_E2E_ROOT: root,
        XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${address.port}/v1`, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } };
    app = await electron.launch(launchOptions);
    const output: string[] = []; app.process().stdout?.on('data', chunk => output.push(String(chunk))); app.process().stderr?.on('data', chunk => output.push(String(chunk)));
    let page = await app.firstWindow(); const consoleErrors: string[] = []; page.on('pageerror', error => consoleErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(async () => {
      const request = indexedDB.open('xiaok-desktop', 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('threads')) request.result.createObjectStore('threads', { keyPath: 'id' }); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('threads', 'readwrite'); tx.objectStore('threads').put({ id: 'e2e-thread', title: 'Multi-agent E2E', status: 'idle', mode: 'chat', createdAt: Date.now(), updatedAt: Date.now(), taskIds: [], currentTaskId: null });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
      location.hash = '#/t/e2e-thread';
    });
    const composer = page.locator('.chat-right-main textarea');
    await expect(composer).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).hasAgentHistory).toBe(false);
    await expect(page.locator('.chat-right-entry')).toHaveCount(0);
    await composer.fill('E2E delegate one review and summarize.'); await composer.press('Enter');
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).agents.find(agent => agent.taskName === 'review')?.status).toBe('completed');
    await expect(page.getByRole('tabpanel', { name: 'SubAgent' })).toBeVisible();
    await expect(page.getByText('E2E_CHILD_DONE', { exact: true }).first()).toBeVisible();
    const surface = page.getByTestId('chat-right-panel');
    await expect(surface).toHaveCount(1);
    await expect(surface.locator('[role="tab"][id$="task-tab"]')).toBeEnabled();
    await surface.locator('[role="tab"][id$="task-tab"]').click();
    await expect(page.getByText('E2E_EXISTING_TASK_PANEL')).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).root?.hostDeliveryStatus).toBe('passed');
    const taskDelivery = surface.locator('.task-panel').getByTestId('host-delivery-status');
    await expect(taskDelivery).toContainText('执行已完成');
    await expect(taskDelivery).toContainText('交付检查通过');
    await expect(taskDelivery).toBeVisible();
    expect(await taskDelivery.evaluate(node => {
      const box = node.getBoundingClientRect(), panel = node.closest('[data-testid="chat-right-panel"]')!.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top >= panel.top && box.bottom <= panel.bottom;
    })).toBe(true);
    expect(await page.locator('.task-panel').evaluate(node => ({ inside: !!node.closest('[data-testid="chat-right-panel"]'), position: getComputedStyle(node).position, shadow: getComputedStyle(node).boxShadow })))
      .toEqual({ inside: true, position: 'static', shadow: 'none' });
    await page.screenshot({ path: join(root, 'single-surface-task.png') });
    await page.keyboard.press('ControlOrMeta+Shift+C');
    await expect(surface.locator('[role="tabpanel"][id$="canvas"]')).toBeVisible();
    await expect(surface).toHaveCount(1); await expect(page.locator('.canvas-panel-tablist')).toHaveCount(1);
    expect(await page.locator('.canvas-panel-tablist').evaluate(node => !!node.closest('[data-testid="chat-right-panel"]'))).toBe(true);
    await page.screenshot({ path: join(root, 'single-surface-canvas.png') });
    const canvasTabs = page.locator('.canvas-panel-tablist');
    await canvasTabs.getByRole('tab', { name: '工具', exact: true }).focus(); await page.keyboard.press('Home');
    await expect(canvasTabs.getByRole('tab', { name: '预览', exact: true })).toBeFocused();
    await expect(surface.locator('[role="tab"][id$="canvas-tab"]')).toHaveAttribute('aria-selected', 'true');
    await surface.locator('[role="tab"][id$="agents-tab"]').click(); await page.keyboard.press('End');
    await expect(surface.locator('[role="tab"][id$="canvas-tab"]')).toBeFocused();
    await expect(canvasTabs.getByRole('tab', { name: '预览', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await surface.locator('.chat-right-tabs > [role="tab"]').evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).tabIndex === 0).length)).toBe(1);
    // Actual product keyboard shortcut unmounts Canvas while its outer tab
    // owns focus; Chromium blurs newly disabled buttons without removing them.
    await page.keyboard.press('Control+Shift+C');
    await expect(surface.locator('[role="tab"][id$="canvas-tab"]')).toBeDisabled();
    await expect(surface.locator('[role="tab"][aria-selected="true"]')).toBeFocused();
    await page.keyboard.press('Control+Shift+C');
    await expect(surface.locator('[role="tabpanel"][id$="canvas"]')).toBeVisible();
    await surface.locator('[role="tab"][id$="agents-tab"]').click();
    await expect(surface.locator(':scope > [role="tabpanel"]:visible')).toHaveCount(1);
    await expect(page.getByText('E2E_CHILD_DONE', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: join(root, 'wide-completed.png') });
    await page.getByLabel('补充说明').fill('E2E_FOLLOWUP'); await page.getByRole('button', { name: '继续执行', exact: true }).click();
    await expect(page.getByText('E2E_FOLLOWUP_DONE', { exact: true }).first()).toBeVisible();
    // Detail C can reveal output before the next status checkpoint S. The
    // next user command uses the visible turn CAS, not an inferred text turn.
    await expect(page.locator('.multi-agent-meta')).toContainText('第 2 轮');
    await page.getByLabel('补充说明').fill('E2E_STALL'); await page.getByRole('button', { name: '继续执行', exact: true }).click();
    await expect(page.getByText('E2E_WAITING_FOR_INTERRUPT', { exact: true }).first()).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 900); });
    await expect(page.getByRole('dialog', { name: 'SubAgent' })).toBeVisible();
    expect(await page.locator('.chat-right-layout').evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(900);
    await page.getByRole('button', { name: '收起侧栏' }).focus(); await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'SubAgent' })).toHaveCount(0);
    expect((await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).agents.find(agent => agent.taskName === 'review')?.executionActive).toBe(true);
    await page.locator('.chat-right-entry').click(); await expect(page.getByRole('button', { name: '收起侧栏' })).toBeFocused();
    // Actual Chromium sequential focus order, including radio and positive
    // tabindex; no JSDOM geometry/selector shim is involved in this probe.
    await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"][id$="agents"]')!;
      const fixture = document.createElement('div'); fixture.id = 'e2e-focus-probe';
      const positive = document.createElement('button'); positive.id = 'e2e-positive'; positive.tabIndex = 2; positive.textContent = 'focus probe';
      const checked = document.createElement('input'); checked.type = 'radio'; checked.name = 'e2e-focus-radio'; checked.checked = true; checked.id = 'e2e-checked';
      const other = document.createElement('input'); other.type = 'radio'; other.name = checked.name;
      fixture.append(positive, checked, other); panel.append(fixture); checked.focus();
    });
    await page.keyboard.press('Tab'); await expect(page.locator('#e2e-positive')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(page.locator('#e2e-checked')).toBeFocused();
    await page.evaluate(() => {
      const fixture = document.getElementById('e2e-focus-probe')!;
      const before = document.createElement('button'); before.id = 'e2e-before-hidden'; before.textContent = 'before hidden';
      const tail = document.createElement('button'); tail.id = 'e2e-hidden-tail'; tail.textContent = 'hidden tail';
      fixture.append(before, tail); tail.focus(); tail.hidden = true;
    });
    await page.keyboard.press('Tab'); await expect(page.locator('#e2e-positive')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(page.locator('#e2e-before-hidden')).toBeFocused();
    await page.getByRole('button', { name: '收起侧栏' }).focus();
    await page.evaluate(() => document.getElementById('e2e-focus-probe')!.remove());
    await page.screenshot({ path: join(root, 'narrow-live-keyboard.png') });
    await page.evaluate(() => {
      const events: unknown[] = []; (window as any).surfaceKeyboardProbe = events;
      for (const capture of [true, false]) window.addEventListener('keydown', event => {
        events.push({ capture, key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, prevented: event.defaultPrevented,
          target: (event.target as HTMLElement)?.id, active: document.activeElement?.id,
          canvas: document.querySelector('[id$="canvas-tab"]')?.getAttribute('aria-selected') });
      }, capture);
    });
    await surface.locator('[role="tab"][id$="canvas-tab"]').click();
    await page.keyboard.press('Control+Shift+C');
    writeFileSync(join(root, 'narrow-canvas-keyboard.json'), JSON.stringify(await page.evaluate(() => (window as any).surfaceKeyboardProbe), null, 2));
    await expect(surface.locator('[role="tab"][id$="canvas-tab"]')).toBeDisabled();
    await expect(surface.locator('[role="tab"][aria-selected="true"]')).toBeFocused();
    await surface.locator('[role="tab"][id$="agents-tab"]').click();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 940); });
    const beforeReopen = await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }));
    const windowOpened = app.waitForEvent('window');
    await app.evaluate(async () => { await (globalThis as any).multiAgentE2E.reopen(); });
    page = await windowOpened; page.on('pageerror', error => consoleErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded'); await page.evaluate(() => { location.hash = '#/t/e2e-thread'; });
    await expect(page.getByRole('tabpanel', { name: 'SubAgent' })).toBeVisible();
    const afterReopen = await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }));
    expect(afterReopen.group?.groupId).toBe(beforeReopen.group?.groupId); expect(afterReopen.group?.bootId).toBe(beforeReopen.group?.bootId);
    expect(afterReopen.agents.find(agent => agent.taskName === 'review')).toMatchObject({ id: beforeReopen.agents.find(agent => agent.taskName === 'review')!.id, turn: 3, executionActive: true });
    await expect(page.getByRole('button', { name: '中断当前轮' })).toBeEnabled(); await page.getByRole('button', { name: '中断当前轮' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).agents.find(agent => agent.taskName === 'review')?.status).toBe('interrupted');
    await page.getByRole('button', { name: '关闭 SubAgent', exact: true }).click();
    await page.locator('.multi-agent-confirm').getByRole('button', { name: '关闭 SubAgent', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).agents.find(agent => agent.taskName === 'review')?.resourcesReleased).toBe(true);
    await page.screenshot({ path: join(root, 'closed.png') });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 900); });
    await expect(page.getByRole('dialog', { name: 'SubAgent' })).toBeVisible();
    await page.screenshot({ path: join(root, 'narrow-drawer.png') });
    await page.getByRole('dialog', { name: 'SubAgent' }).press('Escape');
    await expect(page.getByRole('dialog', { name: 'SubAgent' })).toHaveCount(0);
    await expect(page.locator('.chat-right-main')).not.toHaveAttribute('inert', '');
    await expect(page.locator('.chat-right-entry')).toBeFocused();
    await page.locator('.chat-right-entry').click();
    await page.getByRole('button', { name: '新建执行组', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect((await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).group?.groupId).toBe(beforeReopen.group?.groupId);
    await page.getByRole('button', { name: '新建执行组', exact: true }).click();
    await page.getByRole('button', { name: '确认新建执行组', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).group?.groupId).not.toBe(beforeReopen.group?.groupId);
    await expect(page.getByText('尚未使用 SubAgent 协作。存在独立工作时可自动分派。')).toBeVisible();
    const history = await page.evaluate(groupId => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread', groupId }), beforeReopen.group!.groupId);
    expect(history.group?.historicalOnly).toBe(true);
    expect(history.agents.find(agent => agent.taskName === 'review')).toMatchObject({ resourcesReleased: true, status: 'closed' });
    await page.screenshot({ path: join(root, 'reset-completed.png') });

    // A new Electron process, not just another window, must expose main-owned
    // history with no active root and without replaying any provider request.
    const previousPid = app.process().pid;
    const requestsBeforeRestart = requests.length;
    await app.close(); app = await electron.launch(launchOptions);
    expect(app.process().pid).not.toBe(previousPid);
    app.process().stdout?.on('data', chunk => output.push(String(chunk)));
    app.process().stderr?.on('data', chunk => output.push(String(chunk)));
    page = await app.firstWindow(); page.on('pageerror', error => consoleErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded'); await page.evaluate(() => { location.hash = '#/t/e2e-thread'; });
    await expect(page.locator('.chat-right-main textarea')).toBeVisible();
    const restarted = await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }));
    expect(restarted).toMatchObject({ activeGroupId: null, group: null, root: null, hasAgentHistory: true });
    await expect(page.locator('.chat-right-entry')).toHaveCount(1);
    // This thread also has a real persisted report_progress Task surface. Its
    // existing startup selection must survive; history adds a tab, not another
    // floating window and not a reason to delete or replace the Task content.
    await expect(page.locator('.chat-right-entry')).toHaveText('任务');
    const restartedSurface = page.getByTestId('chat-right-panel');
    await expect(restartedSurface).toHaveCount(1);
    await expect(page.getByText('E2E_EXISTING_TASK_PANEL')).toBeVisible();
    await restartedSurface.locator('[role="tab"][id$="agents-tab"]').click();
    await expect(page.locator('.chat-right-entry')).toHaveText('任务');
    await expect(page.getByRole('button', { name: 'SubAgent 历史', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '执行组历史', exact: true }).click();
    const historicalChoice = page.locator('.multi-agent-history button').filter({ hasText: beforeReopen.group!.groupId.slice(0, 8) });
    await expect(page.locator('.multi-agent-history button')).toHaveCount(2); // Current + one real child group; no empty G2.
    await historicalChoice.click();
    await expect(page.getByText('历史记录，只读', { exact: true })).toBeVisible();
    await expect(historicalChoice).toBeFocused();
    await expect(page.getByRole('button', { name: '继续执行', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '关闭 SubAgent', exact: true })).toBeDisabled();
    await page.screenshot({ path: join(root, 'process-restarted-history.png') });
    const currentChoice = page.getByRole('button', { name: '当前执行组', exact: true });
    await currentChoice.click();
    await expect(page.getByText('历史记录，只读', { exact: true })).toHaveCount(0);
    await expect(currentChoice).toBeFocused();
    expect(requests).toHaveLength(requestsBeforeRestart);
    writeFileSync(join(root, 'process-restart.json'), JSON.stringify({ previousPid, newPid: app.process().pid,
      snapshot: restarted, requestsBeforeRestart, requestsAfterHistory: requests.length }, null, 2));

    // Real IDB + compiled main + actual Sidebar deletion. Only the external
    // cleanup completion is held, so pending is not manufactured by the UI.
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 940); (globalThis as any).multiAgentE2E.holdNextCleanup(); });
    const nextComposer = page.locator('.chat-right-main textarea');
    await nextComposer.fill('E2E_DELETE_TEST delegate cleanup verification.'); await nextComposer.press('Enter');
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).agents.some(agent => agent.taskName === 'deletion_review' && agent.executionActive)).toBe(true);
    // The empty G2 view had the root selected; adding a child must not steal
    // that selection. Select the new child just as a user would.
    await page.locator('.multi-agent-row').filter({ has: page.locator('em.multi-agent-alias') }).last().click();
    await expect(page.getByText('E2E_DELETE_CHILD_RUNNING', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.multi-agent-meta')).not.toContainText('正在启动');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.bringToFront();
    const row = page.getByTestId('thread-item-e2e-thread'); await row.hover();
    const sidebarProbe = await row.evaluate(element => ({ hovered: element.matches(':hover'), hoverDevice: matchMedia('(hover: hover)').matches,
      focused: document.hasFocus(), bounds: element.getBoundingClientRect().toJSON(),
      hits: (() => { const r = element.getBoundingClientRect(); return document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).map(e => ({ tag: e.tagName, classes: e.className, region: getComputedStyle(e).getPropertyValue('-webkit-app-region') })); })(),
      buttons: [...element.querySelectorAll('button')].map(button => ({ name: button.getAttribute('aria-label'), display: getComputedStyle(button).display, title: button.title, classes: button.className })) }));
    writeFileSync(join(root, 'sidebar-delete-probe.json'), JSON.stringify(sidebarProbe, null, 2));
    expect(sidebarProbe.buttons.some(button => button.name === '删除' && button.display !== 'none')).toBe(true);
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await row.getByRole('button', { name: '停止并删除?', exact: true }).click();
    await expect(page.getByText(/仍有执行或资源尚未回收/).first()).toBeVisible(); await expect(row).toBeVisible();
    const pendingDeletion = await page.evaluate(() => window.xiaokDesktop.getMultiAgentThreadDeletion({ threadId: 'e2e-thread' }));
    expect(pendingDeletion).toMatchObject({ deleteState: 'delete_pending', operation: { state: 'cleanup_pending' } });
    // Bundle the production bridge unchanged as a test probe; no test copy of
    // the reservation/CAS algorithm and no additional production preload API.
    const probe = await build({ stdin: { contents: "import { api } from './renderer/src/api/bridge'; globalThis.multiAgentBridgeProbe = api;", resolveDir: desktop, loader: 'ts' },
      bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"test"' } });
    await page.evaluate(source => { (0, eval)(source); }, probe.outputFiles[0].text);
    expect(await page.evaluate(async () => {
      const api = (window as any).multiAgentBridgeProbe;
      const record = await api.getThread('e2e-thread');
      try { await api.updateThreadTaskId('e2e-thread', 'task_new_unattached'); return 'incorrectly-attached'; }
      catch (error) { return { reserved: record.deletionPending, error: String(error) }; }
    })).toMatchObject({ reserved: true, error: expect.stringContaining('thread_deletion_pending') });
    const pendingRecord = await page.evaluate(() => (window as any).multiAgentBridgeProbe.getThread('e2e-thread'));
    await page.screenshot({ path: join(root, 'deletion-pending.png') });
    await app.evaluate(() => (globalThis as any).multiAgentE2E.releaseCleanup());
    await expect.poll(async () => (await page.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' }))).agents.find(agent => agent.taskName === 'deletion_review')?.resourcesReleased).toBe(true);
    await row.hover(); await row.getByRole('button', { name: '删除', exact: true }).click();
    await row.getByRole('button', { name: '停止并删除?', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => window.xiaokDesktop.getMultiAgentThreadDeletion({ threadId: 'e2e-thread' }))).toMatchObject({ deleteState: 'deleted', operation: { state: 'completed' } });
    expect(await page.evaluate(() => (window as any).multiAgentBridgeProbe.getThread('e2e-thread'))).toBeNull();
    // Reproduce two entries recovering a lost local acknowledgement using real
    // IDB and the production bridge; main's completed tombstone is unchanged.
    expect(await page.evaluate(async record => {
      const open = indexedDB.open('xiaok-desktop', 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      const tx = db.transaction('threads', 'readwrite'); tx.objectStore('threads').put(record);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
      const api = (window as any).multiAgentBridgeProbe;
      const results = await Promise.allSettled([api.deleteThread('e2e-thread'), api.deleteThread('e2e-thread')]);
      return { statuses: results.map(result => result.status), record: await api.getThread('e2e-thread') };
    }, pendingRecord)).toEqual({ statuses: ['fulfilled', 'fulfilled'], record: null });
    await page.screenshot({ path: join(root, 'deletion-completed.png') });
    expect(errors).toEqual([]); expect(requests.some(item => item.child)).toBe(true);
    expect(requests.filter(item => !item.child).some(item => item.body.messages.some((message: any) => message.role === 'user'
      && typeof message.content === 'string' && message.content.startsWith('<inter_agent_messages>') && message.content.includes('E2E_CHILD_READY')))).toBe(true);
    expect(consoleErrors).toEqual([]);
    writeFileSync(join(root, 'evidence.json'), JSON.stringify({ requests, errors, consoleErrors, url: page.url(), title: await page.title(), output }, null, 2));
  } finally {
    writeFileSync(join(root, 'provider.json'), JSON.stringify({ requests, errors }, null, 2));
    const lastPage = app?.windows().at(-1);
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({ path: join(root, 'final-window.png') }).catch(() => {});
      const snapshot = await lastPage.evaluate(() => window.xiaokDesktop.getMultiAgentSnapshot({ threadId: 'e2e-thread' })).catch(error => ({ error: String(error) }));
      writeFileSync(join(root, 'final-snapshot.json'), JSON.stringify(snapshot, null, 2));
    }
    await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    console.log(`MULTI_AGENT_E2E_EVIDENCE=${root}`);
  }
});
