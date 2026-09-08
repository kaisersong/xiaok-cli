import { expect, test, _electron as electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { ThreadRecord } from '../../renderer/src/api/types';
import type {} from '../fixtures/goal-attachment-idb-renderer';
import { installationFailure, taskA, taskB } from '../fixtures/goal-attachment-idb-data';

// Browser plugin not available. Native Electron is necessary for the actual
// Chromium IndexedDB transaction, contextBridge exception and IPC listeners.
// Run: npx playwright test --config playwright.e2e.config.ts tests/e2e/goal-attachment-idb.spec.ts
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = join(desktop, 'tests', 'fixtures');
const require = createRequire(join(desktop, 'package.json'));
let built: string;
test.beforeAll(async () => {
  built = mkdtempSync(join(tmpdir(), 'xiaok-u11-native-build-'));
  const common = { bundle: true, logLevel: 'silent' as const,
    nodePaths: [join(desktop, 'node_modules'), join(desktop, '..', 'node_modules')] };
  await Promise.all([
    build({ ...common, entryPoints: [join(fixture, 'goal-attachment-idb-main.mjs')], outfile: join(built, 'main.mjs'),
      platform: 'node', format: 'esm', external: ['electron'] }),
    build({ ...common, entryPoints: [join(fixture, 'goal-attachment-idb-preload.ts')], outfile: join(built, 'preload.cjs'),
      platform: 'node', format: 'cjs', external: ['electron'] }),
    build({ ...common, entryPoints: [join(fixture, 'goal-attachment-idb-renderer.tsx')], outfile: join(built, 'renderer.js'),
      platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' },
      plugins: [{ name: 'u11-presentation-leaves-only', setup(builder) {
        builder.onResolve({ filter: /^\.\/?(?:ChatView|TaskPanel|CanvasPanel)$|^\.\.\/layouts\/AppLayout$/ }, args => {
          if (args.importer === join(desktop, 'renderer', 'src', 'components', 'ChatShell.tsx')) {
            return { path: join(fixture, 'goal-attachment-idb-leaves.tsx') };
          }
          return undefined;
        });
      } }],
    }),
  ]);
  writeFileSync(join(built, 'index.html'), '<!doctype html><html lang="zh"><head><meta charset="UTF-8"><title>U11 native Goal attachment</title>'
    + '<link rel="stylesheet" href="renderer.css"><style>html,body,#root{margin:0;height:100%;width:100%}output{display:block}pre{white-space:pre-wrap}</style>'
    + '</head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
});

interface Instance { app: ElectronApplication; page: Page; errors: string[]; profile: string }
async function launch(throwSubscribe: boolean, profile = join(mkdtempSync(join(tmpdir(), 'xiaok-u11-native-profile-')), 'profile')): Promise<Instance> {
  const env = { ...process.env, NODE_ENV: 'test', XIAOK_U11_PROFILE: profile,
    XIAOK_U11_THROW_SUBSCRIBE: throwSubscribe ? '1' : '0', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
  Reflect.deleteProperty(env, 'ELECTRON_RUN_AS_NODE');
  const app = await electron.launch({ executablePath: require('electron') as string, args: [join(built, 'main.mjs')], env, timeout: 30_000 });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(page).toHaveTitle('U11 native Goal attachment');
  await expect(page.getByTestId('display-source')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  return { app, page, errors, profile };
}
async function close(instance: Instance) {
  const child = instance.app.process();
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
  await instance.app.close();
  await exited; // Actual OS exit before reusing the same native IDB profile.
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}
async function createViaDom(page: Page) {
  await expect.poll(() => page.evaluate(() => window.u11Native.localMetrics().aListeners)).toBe(1);
  await expect(page.getByTestId('display-source')).toHaveText(taskA);
  await page.getByLabel('目标', { exact: true }).fill('U11 new goal');
  await page.getByLabel('完成条件', { exact: true }).fill('U11 complete fixture');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
}
async function rawThread(page: Page): Promise<ThreadRecord> {
  return page.evaluate(async () => {
    // Independent read-only view of the real native record; no fake database,
    // custom mutation, copy of production merge/dedup, or manufactured ACK.
    const id = window.u11Renderer.threadId;
    return new Promise<ThreadRecord>((resolveRead, reject) => {
      const request = indexedDB.open('xiaok-desktop', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('threads', 'readonly');
        const read = transaction.objectStore('threads').get(id);
        transaction.oncomplete = () => { db.close(); resolveRead(read.result as ThreadRecord); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
  });
}
async function recordEvidence(instance: Instance, info: TestInfo, name: string) {
  const result = { raw: await rawThread(instance.page),
    renderer: await instance.page.evaluate(() => ({ threadId: window.u11Renderer.threadId, updates: window.u11Renderer.updates })),
    local: await instance.page.evaluate(() => window.u11Native.localMetrics()),
    main: await instance.page.evaluate(() => window.u11Native.mainMetrics()), errors: instance.errors };
  console.log(`${name} ${JSON.stringify(result)}`);
  const jsonPath = info.outputPath(`${name}.json`), screenshotPath = info.outputPath(`${name}.png`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  await instance.page.screenshot({ path: screenshotPath });
  await info.attach(name, { path: jsonPath, contentType: 'application/json' });
  await info.attach(`${name}.png`, { path: screenshotPath, contentType: 'image/png' });
  return result;
}
async function failedInstallation(instance: Instance, info: TestInfo) {
  await createViaDom(instance.page);
  await expect(instance.page.getByRole('alert')).toContainText(installationFailure);
  const result = await recordEvidence(instance, info, 'u11-after-install-failure');
  expect(result.raw.currentTaskId).toBe(taskB); expect(result.raw.taskIds).toEqual([taskA, taskB]);
  expect(result.renderer.updates).toEqual([{ taskId: taskB, phase: 'begin' }, { taskId: taskB, phase: 'committed' }]);
  expect(result.local.observed.indexOf(`idb:committed:${taskB}`)).toBeLessThan(result.local.observed.indexOf(`on:desktop:taskEvent:${taskB}`));
  expect(result.local.observed.filter(item => item === 'throw:B')).toHaveLength(1);
  expect(result.local.bListeners).toBe(0);
  expect(result.main).toMatchObject({ ack: 0, create: 1, cancel: 0, subscriptions: [taskA] });
  expect(result.main.requestIds).toEqual([expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)]);
  expect(result.errors).toEqual([]);
  return result;
}

test('U11 native commit survives local installation throw and actual Electron process restart without rollback or ACK', async ({}, info) => {
  let instance: Instance | undefined = await launch(true);
  try {
    const before = await failedInstallation(instance, info);
    await expect(instance.page.getByTestId('display-source')).toHaveText(taskA);
    const profile = instance.profile;
    await close(instance); instance = undefined;
    instance = await launch(true, profile);
    await expect(instance.page.getByTestId('display-source')).toHaveText(taskB);
    await expect(instance.page.getByTestId('history')).toContainText('U11 saved A answer');
    await expect(instance.page.getByTestId('history')).toContainText('U11 saved B prepared prompt');
    const after = await recordEvidence(instance, info, 'u11-new-process-saved-B');
    expect(after.raw.id).toBe(before.raw.id);
    expect(after.raw.currentTaskId).toBe(taskB); expect(after.raw.taskIds).toEqual([taskA, taskB]);
    expect(after.renderer.updates).toEqual([]);
    expect(after.main).toMatchObject({ ack: 0, create: 0, cancel: 0, subscriptions: [], recoveries: [taskA, taskB] });
    expect(after.local).toMatchObject({ aListeners: 0, bListeners: 0 });
    expect(after.errors).toEqual([]);
  } finally { if (instance) await close(instance); }
});

test('U11 failed B installation must retain the real A IPC listener and consume its late delivery error in the current page', async ({}, info) => {
  const instance = await launch(true);
  try {
    const after = await failedInstallation(instance, info);
    expect.soft(after.local.aListeners).toBe(1);
    expect.soft(after.local.observed.filter(item => item === `off:desktop:taskEvent:${taskA}`)).toEqual([]);
    await instance.page.evaluate(taskId => window.u11Native.emitLiveEvent(taskId), taskA);
    await expect.soft(instance.page.getByTestId('history')).toContainText(`${taskA} late delivery failure`);
    await expect.soft(instance.page.getByTestId('display-status')).toHaveText('failed');
    await expect(instance.page.getByTestId('display-source')).toHaveText(taskA);
    await recordEvidence(instance, info, 'u11-A-real-event-after-failure');
    expect(instance.errors).toEqual([]);
  } finally { await close(instance); }
});

test('U11 ordinary successful installation control uses one native B listener, one ACK and the same actual IDB transaction', async ({}, info) => {
  const instance = await launch(false);
  try {
    await createViaDom(instance.page);
    await expect(instance.page.getByTestId('display-source')).toHaveText(taskB);
    await expect.poll(() => instance.page.evaluate(() => window.u11Native.mainMetrics())).toMatchObject({ ack: 1, create: 1, cancel: 0 });
    await instance.page.evaluate(taskId => window.u11Native.emitLiveEvent(taskId), taskB);
    await expect(instance.page.getByTestId('question')).toHaveText(`${taskB} live question`);
    await expect(instance.page.getByTestId('display-status')).toHaveText('waiting_user');
    const result = await recordEvidence(instance, info, 'u11-success-control');
    expect(result.raw.currentTaskId).toBe(taskB); expect(result.raw.taskIds).toEqual([taskA, taskB]);
    expect(result.renderer.updates).toEqual([{ taskId: taskB, phase: 'begin' }, { taskId: taskB, phase: 'committed' }]);
    expect(result.local).toMatchObject({ aListeners: 0, bListeners: 1 });
    expect(result.local.observed.filter(item => item === `off:desktop:taskEvent:${taskA}`)).toHaveLength(1);
    expect(result.main.subscriptions).toEqual([taskA, taskB]);
    expect(result.main.requestIds).toEqual([expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)]);
    expect(result.errors).toEqual([]);
  } finally { await close(instance); }
});
