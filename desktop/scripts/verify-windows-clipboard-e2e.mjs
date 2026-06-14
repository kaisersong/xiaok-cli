import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const desktopRoot = resolve(process.cwd());
const appEntry = join(desktopRoot, 'dist', 'main', 'desktop', 'electron', 'main.js');

if (process.platform !== 'win32') {
  throw new Error('This verification script must run on Windows.');
}

if (!existsSync(appEntry)) {
  throw new Error(`Desktop app is not built. Missing: ${appEntry}`);
}

const runRoot = mkdtempSync(join(tmpdir(), 'xiaok-clipboard-e2e-'));
const fixtureDir = join(runRoot, 'fixtures');
const configDir = join(runRoot, 'config');
const screenshotPath = join(runRoot, 'clipboard-e2e-final.png');

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runStaPowerShell(script) {
  execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function setFileDropClipboard(paths) {
  const addItems = paths.map(path => `[void]$files.Add(${psQuote(path)})`).join('; ');
  runStaPowerShell([
    'Add-Type -AssemblyName System.Windows.Forms',
    '$files = New-Object System.Collections.Specialized.StringCollection',
    addItems,
    '[System.Windows.Forms.Clipboard]::SetFileDropList($files)',
  ].join('; '));
}

function setTextClipboard(text) {
  runStaPowerShell([
    'Add-Type -AssemblyName System.Windows.Forms',
    `[System.Windows.Forms.Clipboard]::SetText(${psQuote(text)})`,
  ].join('; '));
}

function setRawImageClipboard() {
  runStaPowerShell([
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$bitmap = New-Object System.Drawing.Bitmap 24,24',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.Clear([System.Drawing.Color]::FromArgb(255, 30, 120, 220))',
    '$graphics.Dispose()',
    '[System.Windows.Forms.Clipboard]::SetImage($bitmap)',
    '$bitmap.Dispose()',
  ].join('; '));
}

function createFixtures() {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Directory -Force -Path ${psQuote(fixtureDir)} | Out-Null`]);
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8AARQAFAAHLAX2sAAAAAElFTkSuQmCC';
  const photoPath = join(fixtureDir, 'photo.png');
  const briefPath = join(fixtureDir, 'brief.txt');
  const pathTextPath = join(fixtureDir, 'path-only.txt');
  writeFileSync(photoPath, Buffer.from(pngBase64, 'base64'));
  writeFileSync(briefPath, 'brief text file\n', 'utf8');
  writeFileSync(pathTextPath, 'path text target\n', 'utf8');
  return { photoPath, briefPath, pathTextPath };
}

async function waitForVisible(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 }).catch(async error => {
    throw new Error(`${label} was not visible: ${error.message}`);
  });
}

async function findChatTextarea(page) {
  const preferred = page.locator([
    'textarea[placeholder="回复..."]',
    'textarea[placeholder="描述你的工作需求..."]',
    'textarea[placeholder="输入消息..."]',
  ].join(', ')).first();
  try {
    await preferred.waitFor({ state: 'visible', timeout: 30_000 });
    return preferred;
  } catch {
    const fallback = page.locator('textarea').first();
    await fallback.waitFor({ state: 'visible', timeout: 5_000 });
    return fallback;
  }
}

async function waitForImageCount(page, minCount) {
  await page.waitForFunction(
    count => document.querySelectorAll('img[alt]').length >= count,
    minCount,
    { timeout: 15_000 },
  );
}

async function pressPaste(page, textarea) {
  await textarea.click();
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(350);
}

const fixtures = createFixtures();
let app;

try {
  app = await electron.launch({
    args: [appEntry],
    cwd: desktopRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      XIAOK_CONFIG_DIR: configDir,
      XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const textarea = await findChatTextarea(page);
  await waitForVisible(textarea, 'chat input textarea');

  setFileDropClipboard([fixtures.photoPath]);
  const imageFilePaths = await page.evaluate(async () => {
    return await window.xiaokDesktop?.readClipboardFilePaths?.();
  });
  await pressPaste(page, textarea);
  await waitForVisible(page.locator('img[alt="photo.png"]').first(), 'pasted image-file chip');
  const imageCountAfterPhoto = await page.locator('img[alt]').count();

  setFileDropClipboard([fixtures.briefPath]);
  await pressPaste(page, textarea);
  await waitForVisible(page.getByText('brief.txt').first(), 'pasted text-file chip');

  await textarea.fill('');
  setTextClipboard(`"${fixtures.pathTextPath}"`);
  await pressPaste(page, textarea);
  await waitForVisible(page.getByText('path-only.txt').first(), 'pasted Windows path text chip');
  await page.waitForFunction(() => {
    const element = document.querySelector('textarea[placeholder="回复..."], textarea[placeholder="描述你的工作需求..."], textarea[placeholder="输入消息..."]');
    return element instanceof HTMLTextAreaElement && element.value === '';
  }, undefined, { timeout: 15_000 });

  setRawImageClipboard();
  await pressPaste(page, textarea);
  await waitForImageCount(page, imageCountAfterPhoto + 1);
  await waitForVisible(page.locator('img[alt^="clipboard-"][alt$=".png"]').first(), 'pasted raw image chip');

  await textarea.fill('');
  setTextClipboard('normal clipboard text');
  await pressPaste(page, textarea);
  await page.waitForFunction(() => {
    const element = document.querySelector('textarea[placeholder="回复..."], textarea[placeholder="描述你的工作需求..."], textarea[placeholder="输入消息..."]');
    return element instanceof HTMLTextAreaElement && element.value === 'normal clipboard text';
  }, undefined, { timeout: 15_000 });

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    screenshotPath,
    fixtures,
    preflight: {
      imageFilePaths,
    },
    checks: [
      'windows-filedrop-image-file',
      'windows-filedrop-text-file',
      'windows-text-path-file',
      'windows-raw-image',
      'normal-text-paste',
    ],
  }, null, 2));
} finally {
  await app?.close().catch(() => {});
}
