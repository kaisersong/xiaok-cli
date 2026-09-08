import { expect, test, _electron as electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Browser plugin not available. Native Electron is used for actual CSS layout,
// overflow, scrollIntoView, smooth scrolling, focus and inert behavior.
// This compiles a test-only renderer to an isolated temporary directory, never
// build:renderer/dist or the installed app. It does not start a task/model.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = join(desktop, 'tests/fixtures');
const require = createRequire(join(desktop, 'package.json'));
let built: string;
test.beforeAll(async () => {
  built = mkdtempSync(join(tmpdir(), 'xiaok-scroll-layout-build-'));
  const common = { bundle: true, logLevel: 'silent' as const,
    nodePaths: [join(desktop, 'node_modules'), join(desktop, '..', 'node_modules')] };
  await Promise.all([
    build({ ...common, entryPoints: [join(fixtures, 'chat-scroll-layout-main.mjs')], outfile: join(built, 'main.mjs'),
      platform: 'node', format: 'esm', external: ['electron'] }),
    build({ ...common, entryPoints: [join(fixtures, 'chat-scroll-layout-renderer.tsx')], outfile: join(built, 'renderer.js'),
      platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: join(desktop, 'tsconfig.renderer.json'), define: { 'process.env.NODE_ENV': '"development"',
        'import.meta.env': '{}', __APP_VERSION__: '"scroll-layout-test"' },
      plugins: [{ name: 'scroll-layout-api-boundary-only', setup(builder) {
        builder.onResolve({ filter: /\/api$/ }, args => args.importer.includes(join('renderer', 'src', 'components'))
          ? { path: join(fixtures, 'chat-scroll-layout-api.ts') } : undefined);
      } }],
    }),
  ]);
  // Use the existing actual generated Tailwind/theme, not a test reimplementation
  // of flex/height utility classes. Source surface CSS comes after it and is
  // rebuilt directly with the actual component, so a production CSS edit is tested.
  const index = readFileSync(join(desktop, 'dist/renderer/index.html'), 'utf8');
  const css = /href="\.\/([^"\s]+\.css)"/.exec(index)?.[1];
  if (!css) throw new Error('missing existing renderer utility CSS');
  writeFileSync(join(built, 'base.css'), readFileSync(join(desktop, 'dist/renderer', css)));
  writeFileSync(join(built, 'index.html'), '<!doctype html><html lang="zh"><head><meta charset="UTF-8"><title>Native Chat scroll boundary</title>'
    + '<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="renderer.css">'
    + '<style>html,body,#root{height:100%;width:100%;margin:0}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
});
async function launch(width = 1280) {
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', XIAOK_SCROLL_LAYOUT_WIDTH: String(width),
    XIAOK_SCROLL_LAYOUT_PROFILE: join(mkdtempSync(join(tmpdir(), 'xiaok-scroll-layout-profile-')), 'profile') };
  Reflect.deleteProperty(env, 'ELECTRON_RUN_AS_NODE');
  const app = await electron.launch({ executablePath: require('electron') as string, args: [join(built, 'main.mjs')], env });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page).toHaveTitle('Native Chat scroll boundary');
  await expect(page.getByTestId('chat-scroll-container')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  return { app, page, errors };
}
async function close(app: ElectronApplication) {
  const child = app.process();
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
  await app.close(); await exited;
}
async function geometry(page: Page) {
  return page.evaluate(() => Object.fromEntries(['.chat-right-layout', '.chat-right-main', '.chat-right-panel', '.chat-right-tabs',
    '.chat-right-entry', '[data-testid="layout-parent"]', '[data-testid="chat-scroll-container"]'].map(selector => {
    const element = document.querySelector<HTMLElement>(selector)!;
    const rect = element.getBoundingClientRect();
    return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height, scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }];
  })));
}
async function record(page: Page, info: TestInfo, name: string) {
  const data = await geometry(page); console.log(name, JSON.stringify(data));
  writeFileSync(info.outputPath(`${name}.json`), JSON.stringify(data, null, 2));
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  return data;
}

test('L1: long initial transcript auto-scroll keeps the sibling tabs and entry inside the output surface', async ({}, info) => {
  const f = await launch();
  try {
    await expect(f.page.getByRole('tab', { name: 'SubAgent', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await geometry(f.page))['[data-testid="chat-scroll-container"]'].scrollTop).toBeGreaterThan(0);
    const data = await record(f.page, info, 'initial-tail');
    expect(data['.chat-right-layout'].scrollTop).toBe(0);
    expect(data['.chat-right-tabs'].top).toBeGreaterThanOrEqual(data['.chat-right-layout'].top);
    expect(data['.chat-right-entry'].top).toBeGreaterThanOrEqual(data['.chat-right-layout'].top);
    expect(data['.chat-right-main'].height).toBeLessThanOrEqual(data['.chat-right-layout'].height);
    expect(f.errors).toEqual([]);
  } finally { await close(f.app); }
});

test('L2: selecting an earlier conversation index scrolls only the transcript and preserves its reading margin', async ({}, info) => {
  const f = await launch();
  try {
    const anchor = f.page.locator('[data-message-anchor="user-4"]');
    await f.page.locator('.conversation-index-tick').nth(4).click();
    await expect.poll(async () => {
      const a = await anchor.boundingBox(), s = await f.page.getByTestId('chat-scroll-container').boundingBox();
      return Math.abs((a!.y - s!.y) - 24);
    }).toBeLessThan(2);
    const data = await record(f.page, info, 'history-index');
    expect(data['.chat-right-layout'].scrollTop).toBe(0);
    expect(data['[data-testid="layout-parent"]'].scrollTop).toBe(0);
    expect(data['.chat-right-tabs'].top).toBeGreaterThanOrEqual(data['.chat-right-layout'].top);
    expect(f.errors).toEqual([]);
  } finally { await close(f.app); }
});

test('L3: actual upward wheel reading is not pulled down by a stream update; explicit tail returns within the transcript', async ({}, info) => {
  const f = await launch();
  try {
    const scroller = f.page.getByTestId('chat-scroll-container');
    await expect.poll(async () => (await geometry(f.page))['[data-testid="chat-scroll-container"]'].scrollTop).toBeGreaterThan(0);
    const bottom = await scroller.evaluate(element => element.scrollTop);
    const bounds = await scroller.boundingBox();
    await f.page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await f.page.mouse.wheel(0, -650);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(bottom - 500);
    const reading = await scroller.evaluate(element => element.scrollTop);
    await f.page.getByRole('button', { name: 'Append stream', exact: true }).click();
    await expect(f.page.getByText(/后续流式输出/)).toBeAttached();
    await f.page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
    expect(Math.abs(await scroller.evaluate(element => element.scrollTop) - reading)).toBeLessThan(2);
    await f.page.getByRole('button', { name: '跳到最新', exact: true }).click();
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
    const data = await record(f.page, info, 'manual-tail');
    expect(data['.chat-right-layout'].scrollTop).toBe(0);
    expect(data['[data-testid="layout-parent"]'].scrollTop).toBe(0);
    expect(data['.chat-right-tabs'].top).toBeGreaterThanOrEqual(data['.chat-right-layout'].top);
    expect(f.errors).toEqual([]);
  } finally { await close(f.app); }
});

test('L5: native focus and wheel reach the right body tail without moving outer frames', async ({}, info) => {
  const f = await launch();
  try {
    const body = f.page.locator('[role="tabpanel"]:visible');
    await f.page.getByTestId('right-tail').focus();
    await expect(f.page.getByTestId('right-tail')).toBeFocused();
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const tailRect = await f.page.getByTestId('right-tail').boundingBox(), bodyRect = await body.boundingBox();
    expect(tailRect!.y).toBeGreaterThanOrEqual(bodyRect!.y);
    expect(tailRect!.y + tailRect!.height).toBeLessThanOrEqual(bodyRect!.y + bodyRect!.height);
    const focused = await record(f.page, info, 'right-focus');
    expect(focused['.chat-right-layout'].scrollTop).toBe(0);
    expect(focused['[data-testid="layout-parent"]'].scrollTop).toBe(0);
    expect(focused['.chat-right-tabs'].top).toBeGreaterThanOrEqual(focused['.chat-right-layout'].top);
    const before = await body.evaluate(element => element.scrollTop), bounds = await body.boundingBox();
    await f.page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await f.page.mouse.wheel(0, -300);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeLessThan(before);
    expect((await geometry(f.page))['.chat-right-layout'].scrollTop).toBe(0);
    expect(f.errors).toEqual([]);
  } finally { await close(f.app); }
});

test('L6: new output at the tail follows only its own scroller', async ({}, info) => {
  const f = await launch();
  try {
    const scroller = f.page.getByTestId('chat-scroll-container');
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const before = await scroller.evaluate(element => element.scrollHeight);
    await f.page.getByRole('button', { name: 'Append stream', exact: true }).click();
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight)).toBeGreaterThan(before);
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
    const data = await record(f.page, info, 'stream-tail');
    expect(data['.chat-right-layout'].scrollTop).toBe(0);
    expect(data['[data-testid="layout-parent"]'].scrollTop).toBe(0);
    expect(data['.chat-right-tabs'].top).toBeGreaterThanOrEqual(data['.chat-right-layout'].top);
  } finally { await close(f.app); }
});

test('L7: the outer layout cannot be programmatically scrolled even when the absolute live region overflows', async ({}, info) => {
  const f = await launch();
  try {
    await expect(f.page.locator('.multi-agent-panel .sr-only')).toHaveCSS('position', 'absolute');
    await f.page.locator('.chat-right-layout').evaluate(element => element.scrollTo({ top: 200 }));
    const data = await record(f.page, info, 'outer-scroll-boundary');
    expect(data['.chat-right-layout'].scrollTop).toBe(0);
    expect(data['[data-testid="layout-parent"]'].scrollTop).toBe(0);
  } finally { await close(f.app); }
});

test('L4: 900/899 responsive transitions retain visible tabs, modal inert and entry focus without scrolling the surface', async ({}, info) => {
  const f = await launch(900);
  try {
    await expect(f.page.getByTestId('chat-right-panel')).toHaveAttribute('role', 'complementary');
    await expect(f.page.getByRole('tab', { name: 'SubAgent', exact: true })).toHaveAttribute('aria-selected', 'true');
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(899, 820));
    await expect(f.page.getByTestId('chat-right-panel')).toHaveAttribute('role', 'dialog');
    await expect(f.page.getByTestId('chat-right-main')).toHaveAttribute('inert', '');
    const narrow = await record(f.page, info, 'narrow-panel');
    expect(narrow['.chat-right-layout'].scrollTop).toBe(0);
    expect(narrow['.chat-right-tabs'].top).toBeGreaterThanOrEqual(narrow['.chat-right-layout'].top);
    await f.page.getByTestId('right-tail').focus();
    await expect(f.page.getByTestId('right-tail')).toBeFocused();
    await expect.poll(() => f.page.locator('[role="tabpanel"]:visible').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const tailRect = await f.page.getByTestId('right-tail').boundingBox(), bodyRect = await f.page.locator('[role="tabpanel"]:visible').boundingBox();
    expect(tailRect!.y).toBeGreaterThanOrEqual(bodyRect!.y);
    expect(tailRect!.y + tailRect!.height).toBeLessThanOrEqual(bodyRect!.y + bodyRect!.height);
    await f.page.keyboard.press('Tab');
    await expect(f.page.getByRole('tab', { name: 'SubAgent', exact: true })).toBeFocused();
    await f.page.keyboard.press('Shift+Tab');
    await expect(f.page.getByTestId('right-tail')).toBeFocused();
    expect((await geometry(f.page))['.chat-right-panel'].scrollTop).toBe(0);
    expect((await geometry(f.page))['.chat-right-layout'].scrollTop).toBe(0);
    await f.page.locator('.chat-right-close').click();
    await expect(f.page.locator('.chat-right-entry')).toBeFocused();
    await expect(f.page.getByTestId('chat-right-main')).not.toHaveAttribute('inert', '');
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 820));
    await f.page.locator('.chat-right-entry').click();
    await expect(f.page.getByTestId('chat-right-panel')).toHaveAttribute('role', 'complementary');
    const wide = await record(f.page, info, 'wide-reopened');
    expect(wide['.chat-right-layout'].scrollTop).toBe(0);
    expect(wide['.chat-right-tabs'].top).toBeGreaterThanOrEqual(wide['.chat-right-layout'].top);
    expect(f.errors).toEqual([]);
  } finally { await close(f.app); }
});
