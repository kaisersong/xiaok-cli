import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(TEST_DIR, '..', '..');
const describeE2E = process.env.XIAOK_E2E ? test.describe : test.describe.skip;

describeE2E('independent meeting recorder window', () => {
  let app: ElectronApplication;
  let mainPage: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [
        join(DESKTOP_ROOT, 'dist', 'main', 'desktop', 'electron', 'main.js'),
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
      },
    });
    mainPage = await app.firstWindow();
    await mainPage.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('opens one recorder, keeps its audio session while compact, and restores workbench geometry', async () => {
    const recorderPromise = app.waitForEvent('window');
    await mainPage.evaluate(async () => {
      await window.xiaokDesktop?.meetingOpenRecorderWindow({ collectionId: 'e2e-recorder' });
    });
    const recorder = await recorderPromise;
    await recorder.waitForLoadState('domcontentloaded');

    await expect(recorder.getByRole('main', { name: 'AI录音' })).toBeVisible();
    await expect(recorder.getByRole('button', { name: '开始录音' })).toBeVisible();
    await recorder.getByRole('button', { name: '开始录音' }).click();
    await expect(recorder.getByRole('button', { name: '完成' })).toBeVisible();

    await recorder.getByRole('button', { name: '缩小为悬浮窗' }).click();
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/meeting-recorder/'));
      return target ? { ...target.getBounds(), alwaysOnTop: target.isAlwaysOnTop() } : null;
    })).toMatchObject({ width: 420, height: 160, alwaysOnTop: true });

    await expect(recorder.getByRole('main', { name: 'AI录音' })).toHaveCSS('-webkit-app-region', 'drag');
    await expect(recorder.getByRole('button', { name: '展开录音窗口' })).toHaveCSS('-webkit-app-region', 'no-drag');
    await expect(recorder.getByRole('button', { name: '暂停' })).toHaveCSS('-webkit-app-region', 'no-drag');
    await expect(recorder.getByRole('button', { name: '完成' })).toHaveCSS('-webkit-app-region', 'no-drag');

    await expect(recorder.getByRole('button', { name: '展开录音窗口' })).toBeVisible();
    await recorder.getByRole('button', { name: '展开录音窗口' }).click();
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const recorders = BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('/meeting-recorder/'));
      const target = recorders[0];
      return target ? { count: recorders.length, ...target.getBounds(), alwaysOnTop: target.isAlwaysOnTop() } : null;
    })).toMatchObject({ count: 1, width: 1180, height: 760, alwaysOnTop: false });

    await mainPage.evaluate(async () => {
      await window.xiaokDesktop?.meetingOpenRecorderWindow({ collectionId: 'e2e-recorder' });
    });
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('/meeting-recorder/')).length
    ))).toBe(1);
  });
});
