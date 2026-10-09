import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer as createHttpServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { createBrokerService } from '../../../../intent-broker/src/broker/service.js';
import { createServer as createBrokerHttpServer } from '../../../../intent-broker/src/http/server.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const soak = process.env.XIAOK_ACTIVITY_SOAK === '1';

test('project activity returns to its real conversation without changing a draft and survives a view restart', async () => {
  test.setTimeout(soak ? 25 * 60_000 : 90_000);
  const root = mkdtempSync(join(tmpdir(), 'xiaok-activity-electron-'));
  for (const folder of ['workspace', 'config', 'source']) mkdirSync(join(root, folder));
  const evidence: Array<Record<string, unknown>> = [];
  const record = (value: Record<string, unknown>) => { evidence.push({ at: Date.now(), ...value }); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); };
  const broker = createBrokerService({ dbPath: join(root, 'broker.sqlite') });
  const brokerHttp = createBrokerHttpServer({ broker, roomService: broker.room, roomDesktopToken: 'fixture', roomKSwarmToken: 'fixture-kswarm' });
  broker.attachWebSocket(brokerHttp.raw());
  await brokerHttp.listen(0, '127.0.0.1');
  const brokerUrl = `http://127.0.0.1:${brokerHttp.address().port}`;
  const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const sourcePort = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  const sourceUrl = `http://127.0.0.1:${sourcePort}`;
  const sourceLog = createWriteStream(join(root, 'kswarm.log'));
  let nativeSource: ChildProcess | undefined, mcpSource: ChildProcess | undefined;
  let source: ChildProcess | undefined, app: ElectronApplication | undefined;
  let activityOwnerPid: number | undefined, nativeAppPid: number | undefined;
  let modelCalls = 0;
  const model = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); modelCalls++;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = modelCalls === 1 ? { tool_calls: [{ index: 0, id: 'create-project', type: 'function', function: { name: 'create_project',
      arguments: JSON.stringify({ name: 'Activity E2E project', goal: 'Observe source changes', memberCount: 1 }) } }] } : { content: 'PROJECT_CREATED' };
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: modelCalls === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    record({ modelCalls, messageCount: body.messages?.length });
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  try {
    const spawnSource = () => { source = spawn(process.execPath, ['src/server/index.js'], { cwd: join(desktop, '..', '..', 'kswarm'),
      env: { ...process.env, HOME: join(root, 'source'), USERPROFILE: join(root, 'source'), KSWARM_DATA_ROOT: join(root, 'source'),
        XIAOK_CONFIG_DIR: join(root, 'config'), KSWARM_PORT: String(sourcePort), BROKER_URL: brokerUrl,
        KSWARM_DESKTOP_MUTATION_TOKEN: 'fixture', INTENT_BROKER_KSWARM_TOKEN: 'fixture-kswarm' }, stdio: ['ignore', 'pipe', 'pipe'] });
    source.stdout!.pipe(sourceLog, { end: false }); source.stderr!.pipe(sourceLog, { end: false });
      return source; };
    spawnSource();
    await expect.poll(async () => { try { return (await fetch(`${sourceUrl}/health`)).status; } catch { return 0; } }, { timeout: 15_000 }).toBe(200);
    const launchOptions = { args: [join(desktop, 'tests/e2e/fixtures/multi-agent-electron-main.mjs')], env: { ...process.env,
      NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_E2E_USER_DATA: join(root, 'profile'), XIAOK_MULTI_AGENT_E2E_ROOT: root,
      XIAOK_MULTI_AGENT_E2E_PROVIDER: `http://127.0.0.1:${(model.address() as net.AddressInfo).port}/v1`,
      XIAOK_ACTIVITY_E2E_OWNER: 'daemon', XIAOK_ACTIVITY_E2E_KSWARM_URL: sourceUrl, XIAOK_ACTIVITY_E2E_BROKER_URL: brokerUrl,
      XIAOK_DISABLE_GLOBAL_PLUGINS: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } };
    app = await electron.launch(launchOptions); record({ phase: 'app-launched' });
    let page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
    const ownerStatus = JSON.parse(readFileSync(join(root, 'data', 'activity-owner.status.json'), 'utf8')) as { pid: number; ownerEpoch: string };
    activityOwnerPid = ownerStatus.pid;
    nativeAppPid = JSON.parse(readFileSync(join(root, 'e2e-process.json'), 'utf8')).pid;
    expect(ownerStatus.pid).not.toBe(nativeAppPid); record({ phase: 'owner-status', ownerStatus });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(async () => {
      const request = indexedDB.open('xiaok-desktop', 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('threads')) request.result.createObjectStore('threads', { keyPath: 'id' });
      }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const tx = db.transaction('threads', 'readwrite');
      tx.objectStore('threads').put({ id: 'activity-thread', title: 'Activity E2E', status: 'idle', mode: 'chat', createdAt: Date.now(), updatedAt: Date.now(), taskIds: [], currentTaskId: null });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close(); location.hash = '#/t/activity-thread';
    });
    const composer = () => page.locator('.chat-right-main textarea');
    await expect(composer()).toBeVisible(); await composer().fill('创建一个项目，用于跟进工作进展'); await composer().press('Enter');
    await expect(page.getByTestId('conversation-activity')).toBeVisible({ timeout: 40_000 });
    const activities = () => page.evaluate(() => window.xiaokDesktop.getConversationActivities({ threadId: 'activity-thread', limit: 200 }));
    const initial = await activities();
    const watchId = initial[0].watchId;
    const work = await page.evaluate(id => window.xiaokDesktop.getWorkActivity(id), watchId);
    const projectId = work.watch.workId;
    expect(work.watch.origin.threadId).toBe('activity-thread'); expect(work.projection.executionState).not.toBe('completed');
    const afterCreationCalls = modelCalls;
    const draft = '中文输入保持\n第二行尚未发送'; await composer().fill(draft); await composer().focus();
    const mutate = async (index: number) => {
      const response = await fetch(`${sourceUrl}/projects/${projectId}/execution-mode`, { method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-kswarm-mutation-token': 'fixture' }, body: JSON.stringify({ executionMode: index % 2 ? 'workflow_preferred' : 'direct' }) });
      expect(response.ok).toBe(true);
    };
    await mutate(1);
    await expect.poll(async () => (await activities()).at(-1)?.projection.sourceSequence).toBeGreaterThan(work.projection.sourceSequence);
    await expect(composer()).toHaveValue(draft); await expect(composer()).toBeFocused(); expect(modelCalls).toBe(afterCreationCalls);
    await page.screenshot({ path: join(root, 'draft-preserved.png') });
    record({ phase: 'draft-preserved', projectId, watchId, modelCalls, sourceSequence: (await activities()).at(-1)?.projection.sourceSequence });
    if (!soak) {
      const epochBefore = (await page.evaluate(id => window.xiaokDesktop.getWorkActivity(id),watchId)).watch.sourceDataEpoch;
      source!.kill('SIGTERM'); await new Promise<void>(resolve => source!.once('exit',()=>resolve()));
      await expect(page.getByRole('status')).toBeVisible();
      spawnSource(); await expect.poll(async()=>{try{return(await fetch(`${sourceUrl}/health`)).status;}catch{return 0;}}).toBe(200);
      await mutate(2);
      await expect.poll(async()=>(await page.evaluate(id=>window.xiaokDesktop.getWorkActivity(id),watchId)).projection.freshness).toBe('fresh');
      expect((await page.evaluate(id=>window.xiaokDesktop.getWorkActivity(id),watchId)).watch.sourceDataEpoch).toBe(epochBefore);
      await expect(composer()).toHaveValue(draft);expect(modelCalls).toBe(afterCreationCalls);record({phase:'real-source-disconnect-reconnect-no-replay'});
    }
    if (!soak) {
      nativeSource = spawn(process.execPath, [join(desktop, 'tests/e2e/fixtures/activity-native-source.mjs'), join(desktop, 'dist/main'), join(root, 'data'), 'activity-thread'], { stdio: ['ignore','pipe','pipe'] });
      const native = await new Promise<{ url: string; watchId: string }>((resolve, reject) => {
        let output = ''; nativeSource!.stdout!.on('data', data => { output += data; if (output.includes('\n')) { try { resolve(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); } } });
        nativeSource!.stderr!.on('data', data => record({ nativeSourceDiagnostic: data.toString().slice(0,1024) }));
        nativeSource!.once('error', reject);
      });
      const receive = async (note: string) => { const response = await fetch(`${native.url}/receipt`, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ note }) }); expect(response.ok).toBe(true); return response.json() as Promise<{ committedAt: number }>; };
      await page.evaluate(async () => {
        const request = indexedDB.open('xiaok-desktop', 1);
        const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
        const tx = db.transaction('threads', 'readwrite');
        tx.objectStore('threads').put({ id: 'activity-other', title: 'Other E2E', status: 'idle', mode: 'chat', createdAt: Date.now(), updatedAt: Date.now(), taskIds: [], currentTaskId: null });
        await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close(); location.hash = '#/t/activity-other';
      });
      await expect(composer()).toBeVisible(); await composer().fill('另一会话草稿');
      await expect(page.getByTestId(`activity-work-${watchId}`)).toHaveCount(0);
      await receive('Other thread completion evidence');
      await expect.poll(() => page.evaluate(() => window.xiaokDesktop.getConversationActivityUnread())).toContainEqual(expect.objectContaining({ threadId: 'activity-thread' }));
      await expect(page.getByTestId(`activity-work-${watchId}`)).toHaveCount(0); await expect(composer()).toHaveValue('另一会话草稿');
      await page.evaluate(() => { location.hash = '#/t/activity-thread'; }); await expect(page.getByTestId(`activity-work-${watchId}`)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.xiaokDesktop.getConversationActivityUnread())).not.toContainEqual(expect.objectContaining({ threadId: 'activity-thread' }));
      await composer().fill(draft); await composer().focus(); record({ phase: 'other-thread-unread-and-return' });
      writeFileSync(join(root,'e2e-control.json'),JSON.stringify({action:'second',nonce:Date.now()}));
      const second=await app!.context().waitForEvent('page');await second.waitForLoadState('domcontentloaded');await second.evaluate(()=>{location.hash='#/t/activity-thread';});
      await expect(second.getByTestId(`activity-work-${native.watchId}`)).toBeVisible();
      await receive('TWO_VIEW_ONE_FACT');await expect(page.getByTestId(`activity-work-${native.watchId}`)).toContainText('TWO_VIEW_ONE_FACT');await expect(second.getByTestId(`activity-work-${native.watchId}`)).toContainText('TWO_VIEW_ONE_FACT');
      const twoViewDb=new DatabaseSync(join(root,'data','conversation-activity.sqlite'),{readOnly:true});
      expect((twoViewDb.prepare("SELECT COUNT(*) count FROM source_events WHERE content_json LIKE '%TWO_VIEW_ONE_FACT%'").get() as {count:number}).count).toBe(1);twoViewDb.close();
      writeFileSync(join(root,'e2e-control.json'),JSON.stringify({action:'close-second',nonce:Date.now()}));await second.waitForEvent('close');
      await receive('REMAINING_VIEW_CONTINUES');await expect(page.getByTestId(`activity-work-${native.watchId}`)).toContainText('REMAINING_VIEW_CONTINUES');record({phase:'two-views-one-native-fact'});
      const latency: number[] = [];
      for (let index=0;index<100;index++) {
        const label = `LATENCY_${index}`; const { committedAt } = await receive(label);
        await expect(page.getByTestId(`activity-work-${native.watchId}`)).toContainText(label);
        latency.push(Date.now()-committedAt); await expect(composer()).toHaveValue(draft);
      }
      const sorted=[...latency].sort((a,b)=>a-b); const p95=sorted[94];
      record({ phase:'100-source-commit-to-DOM', samplesMs:latency,p95Ms:p95,maxMs:sorted[99] }); expect(p95).toBeLessThanOrEqual(2000);
      await expect(page.getByTestId(`activity-work-${native.watchId}`)).not.toContainText('已完成');
      const finished=await fetch(`${native.url}/finish`,{method:'POST'});expect(finished.ok).toBe(true);
      await expect(page.getByTestId(`activity-work-${native.watchId}`)).toContainText('已完成');
      mcpSource = spawn(process.execPath, [join(desktop,'tests/e2e/fixtures/activity-mcp-source.mjs'),join(desktop,'dist/main'),join(root,'data'),'activity-thread'], { stdio:['ignore','pipe','pipe'] });
      const pending = await new Promise<{ url:string;watchId:string }>((resolve,reject)=>{let output='';mcpSource!.stdout!.on('data',data=>{output+=data;if(output.includes('\n')){try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}}});mcpSource!.once('error',reject);mcpSource!.stderr!.on('data',data=>record({mcpDiagnostic:data.toString().slice(0,1024)}));});
      await expect(page.getByTestId(`activity-work-${pending.watchId}`)).toContainText('选择输出格式');
      expect((await(await fetch(`${pending.url}/stats`)).json()).updates).toBe(0);
      writeFileSync(join(root,'e2e-control.json'),JSON.stringify({action:'reopen',nonce:Date.now()}));await page.waitForEvent('close');page=await app!.firstWindow();await page.waitForLoadState('domcontentloaded');await page.evaluate(()=>{location.hash='#/t/activity-thread';});
      const pendingCard=page.getByTestId(`activity-work-${pending.watchId}`);await expect(pendingCard).toContainText('选择输出格式');
      expect((await(await fetch(`${pending.url}/stats`)).json()).updates).toBe(0);
      await pendingCard.getByRole('combobox').first().selectOption('pdf');await pendingCard.getByRole('button',{name:/提交|Submit/}).click();
      await expect.poll(async()=>(await(await fetch(`${pending.url}/stats`)).json()).updates).toBe(1);
      await pendingCard.getByRole('button',{name:/取消工作|Cancel work/}).click();await expect(pendingCard).toContainText(/已请求取消|Cancellation requested/);
      expect((await(await fetch(`${pending.url}/stats`)).json()).status).toBe('working');
      await fetch(`${pending.url}/confirm-cancel`,{method:'POST'});await expect(pendingCard).toContainText('已取消');record({phase:'real-MCP-input-reopen-and-cooperative-cancel'});


    }
    if (soak) {
      const started = Date.now();
      for (let minute = 1; minute <= 20; minute++) {
        await expect.poll(() => Date.now() - started, { timeout: 70_000, intervals: [1000, 10_000] }).toBeGreaterThanOrEqual(minute * 60_000);
        await mutate(minute + 1);
        const rows = await activities(); const reports = rows.filter(row => row.kind === 'report');
        if (minute % 5 === 0) await expect.poll(async () => (await activities()).filter(row => row.kind === 'report').length, { timeout: 10_000 }).toBeGreaterThanOrEqual(minute / 5);
        await expect(composer()).toHaveValue(draft); await expect(composer()).toBeFocused(); expect(modelCalls).toBe(afterCreationCalls);
        record({ phase: 'soak', minute, reports: reports.length, modelCalls });
      }
      record({ phase: 'soak-complete', elapsedMs: Date.now() - started });
    }
    writeFileSync(join(root, 'e2e-control.json'), JSON.stringify({ action: 'reopen', nonce: Date.now() }));
    await page.waitForEvent('close');
    page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => { location.hash = '#/t/activity-thread'; });
    await expect(page.getByTestId(`activity-work-${watchId}`)).toBeVisible();
    const beforeExit = (await page.evaluate(id => window.xiaokDesktop.getWorkActivity(id), watchId)).projection.sourceSequence;
    writeFileSync(join(root, 'e2e-control.json'), JSON.stringify({ action: 'quit', nonce: Date.now() }));
    await app.waitForEvent('close'); app = undefined;
    await mutate(99);
    const offlineDb = new DatabaseSync(join(root, 'data', 'conversation-activity.sqlite'), { readOnly: true });
    const offlineProjection = () => JSON.parse((offlineDb.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watchId) as { data_json: string }).data_json);
    await expect.poll(() => offlineProjection().sourceSequence).toBeGreaterThan(beforeExit);
    expect(() => process.kill(ownerStatus.pid, 0)).not.toThrow();
    const closed = await fetch(`${sourceUrl}/projects/${projectId}/close`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kswarm-mutation-token': 'fixture' }, body: JSON.stringify({ summary: 'E2E source finished' }) });
    await expect.poll(() => offlineProjection().executionState).toBe('cancelled');
    offlineDb.close(); expect(modelCalls).toBe(afterCreationCalls);
    record({ phase: 'desktop-exited-source-observed', ownerPid: ownerStatus.pid, ownerEpoch: ownerStatus.ownerEpoch, sourcePid: source.pid, modelCalls });
    app = await electron.launch(launchOptions); page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => { location.hash = '#/t/activity-thread'; });
    expect(closed.ok).toBe(true);
    await expect.poll(async () => (await page.evaluate(id => window.xiaokDesktop.getWorkActivity(id), watchId)).projection.executionState).toBe('cancelled');
    await expect(page.getByTestId(`activity-work-${watchId}`)).toContainText('已关闭');
    expect(modelCalls).toBe(afterCreationCalls); expect(errors).toEqual([]);
    await page.screenshot({ path: join(root, 'completed.png') });
    if (!soak) {
      const rowsBeforeDelete = new DatabaseSync(join(root, 'data', 'conversation-activity.sqlite'), { readOnly: true });
      const beforeCount = Number((rowsBeforeDelete.prepare('SELECT COUNT(*) count FROM conversation_activities WHERE thread_id=?').get('activity-thread') as { count: number }).count);
      const thread = page.getByTestId('thread-item-activity-thread'); await thread.hover();
      await thread.getByRole('button', { name: /^删除$|^Delete$/ }).click();
      await thread.getByRole('button', { name: /停止并删除|Stop and delete/ }).click();
      await expect(thread).toHaveCount(0); await mutate(78);
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(Number((rowsBeforeDelete.prepare('SELECT COUNT(*) count FROM conversation_activities WHERE thread_id=?').get('activity-thread') as { count: number }).count)).toBe(beforeCount);
      rowsBeforeDelete.close(); expect((await fetch(`${sourceUrl}/projects/${projectId}`)).ok).toBe(true);
      await expect(page.getByTestId(`activity-work-${watchId}`)).toHaveCount(0); record({ phase: 'real-renderer-delete-cas-no-late-activity' });
    }
    record({ phase: 'passed', projectId, modelCalls, root });
  } finally {
    if (app) { writeFileSync(join(root, 'e2e-control.json'), JSON.stringify({ action: 'quit', nonce: Date.now() })); await Promise.race([app.waitForEvent('close'), new Promise(resolve => setTimeout(resolve, 5000))]); if (nativeAppPid) { try { process.kill(nativeAppPid, 'SIGTERM'); } catch {} } }
    if (activityOwnerPid) { try { process.kill(activityOwnerPid, 'SIGTERM'); await expect.poll(() => { try { process.kill(activityOwnerPid!, 0); return true; } catch { return false; } }).toBe(false); } catch {} }
    if (mcpSource && mcpSource.exitCode === null) { mcpSource.kill('SIGTERM'); await new Promise<void>(resolve => mcpSource!.once('exit',()=>resolve())); }
    if (nativeSource && nativeSource.exitCode === null) { nativeSource.kill('SIGTERM'); await new Promise<void>(resolve => nativeSource!.once('exit', () => resolve())); }
    if (source && source.exitCode === null) { source.kill('SIGTERM'); await new Promise<void>(resolve => source!.once('exit', () => resolve())); }
    sourceLog.end(); await new Promise<void>(resolve => model.close(() => resolve()));
    await brokerHttp.close(); broker.close();
    console.log(`activity E2E evidence: ${root}`);
  }
});
