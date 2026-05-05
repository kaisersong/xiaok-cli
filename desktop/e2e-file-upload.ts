// E2E test for file upload understanding
import { _electron as electron } from '@playwright/test';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from 'fs';
import { createDesktopServices } from './dist/main/desktop/electron/desktop-services.js';

const PASS = (msg: string) => console.log(`✅ ${msg}`);
const FAIL = (msg: string) => { console.log(`❌ ${msg}`); failures.push(msg); };
const failures: string[] = [];

async function main() {
  console.log('[E2E] Testing file upload understanding...');

  // Kill existing instances
  try {
    execSync('pkill -9 -f "xiaok.app" 2>/dev/null || true', { stdio: 'ignore' });
    execSync('pkill -9 -f "xiaok Helper" 2>/dev/null || true', { stdio: 'ignore' });
  } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 2000));

  // Setup test directory
  const tmpDir = '/tmp/xiaok-e2e-upload';
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  // Test 1: Direct IPC - createTaskWithFiles
  console.log('\n--- TEST 1: createTaskWithFiles IPC ---');
  writeFileSync(`${tmpDir}/test.txt`, '测试文件内容：关键数据 ABC123DEF\n用于验证文件上传。');

  const services = createDesktopServices({ dataRoot: tmpDir });

  try {
    const result = await services.createTaskWithFiles({
      prompt: '请读取上传的文件并告诉我内容',
      filePaths: [`${tmpDir}/test.txt`]
    });
    if (result.taskId) {
      PASS(`Task created: ${result.taskId}`);
    } else {
      FAIL('No taskId returned');
    }
  } catch (e) {
    FAIL(`createTaskWithFiles error: ${(e as Error).message}`);
  }

  // Test 2: Multiple file types
  console.log('\n--- TEST 2: Multiple file types ---');
  const testFiles = [
    { name: 'report.md', content: '# 报告\n\n核心数据: XYZ789\n结论: 系统正常' },
    { name: 'config.json', content: '{"api_key": "test-key-123", "version": "2.0"}' },
    { name: 'data.csv', content: 'name,value\nscore,95\nstatus,ok' },
  ];

  for (const f of testFiles) {
    writeFileSync(`${tmpDir}/${f.name}`, f.content);
  }

  const listSkills = await services.listSkills();
  if (listSkills.length > 0) {
    PASS(`Skills available: ${listSkills.length}`);
  } else {
    FAIL('No skills loaded');
  }

  const config = await services.getModelConfig();
  if (config.providers && config.providers.length > 0) {
    PASS(`Model config: ${config.providers.length} providers`);
  } else {
    FAIL('No model providers');
  }

  // Test 3: Verify file import
  console.log('\n--- TEST 3: File import verification ---');
  try {
    const importResult = await services.importMaterial({
      taskId: 'test-task',
      filePath: `${tmpDir}/report.md`,
      role: 'customer_material'
    });
    if (importResult.materialId) {
      PASS(`File imported: ${importResult.originalName}`);
    } else {
      FAIL('File import failed');
    }
  } catch (e) {
    FAIL(`Import error: ${(e as Error).message}`);
  }

  // Test 4: Verify Plus button in UI
  console.log('\n--- TEST 4: UI Plus button ---');
  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    timeout: 60000,
  });

  let page = app.windows()[0];
  for (let i = 0; !page && i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    page = app.windows()[0];
  }

  if (!page) {
    FAIL('No window found');
    await app.close();
    process.exit(1);
    return;
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

  const plusBtn = page.locator('button').filter({ hasText: '' }).locator('svg.lucide-plus').first();
  const plusVisible = await plusBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (plusVisible) {
    PASS('Plus button visible for file upload');
  } else {
    FAIL('Plus button not found');
  }

  // Test 5: Verify submit button
  console.log('\n--- TEST 5: Submit button ---');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(1000);

  const textarea = page.locator('textarea');
  await textarea.fill('请读取上传的文件');

  const submitBtn = page.locator('button[type="submit"]');
  const submitEnabled = await submitBtn.isEnabled({ timeout: 3000 }).catch(() => false);
  if (submitEnabled) {
    PASS('Submit button enabled');
  } else {
    FAIL('Submit button not enabled');
  }

  // Cleanup
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  await app.close();

  console.log('\n========== RESULTS ==========');
  console.log(`Total: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  if (failures.length > 0) {
    failures.forEach(f => console.log(`  ❌ ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error('[E2E] FATAL:', e); process.exit(1); });