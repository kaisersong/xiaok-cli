// Native Windows regression through production tool and interactive entry points.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
if (process.platform !== 'win32') throw new Error('Native Windows required');
const [mode, runtimePath, work, entry] = process.argv.slice(2);
if (mode === '--child') {
  const { bashTool, runInteractiveShellCommand } = await import(pathToFileURL(runtimePath));
  const command = `start "" /b "${process.execPath}" "${join(work, 'hold.cjs')}" "${join(work, 'holder.json')}"`;
  const result = entry === 'tool' ? await bashTool.execute({ command, timeout_ms: 300 })
    : await runInteractiveShellCommand(command, { cwd: work });
  await writeFile(join(work, 'result.json'), JSON.stringify({ result, returnedAt: Date.now() }));
  process.exit(0);
}
const expectHang = process.argv.includes('--expect-hang');
const results = [];
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function killOwned(pid) {
  if (!pid || !alive(pid)) return;
  const killer = spawn('taskkill.exe', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { killer.once('error', reject); killer.once('close', resolve); });
}
for (const entry of ['tool', 'interactive']) {
  const dir = await mkdtemp(join(tmpdir(), 'xiaok inherited pipes '));
  let parent; let holder;
  try {
    await writeFile(join(dir, 'hold.cjs'), "require('node:fs').writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,parentPid:process.ppid,fixturePath:__filename}));console.log('owned fixture holds inherited stdout');setInterval(()=>{},1000);");
    const start = Date.now();
    parent = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', runtimePath, dir, entry], { stdio: 'ignore', windowsHide: true });
    const deadline = Date.now() + 3500;
    let result;
    while (Date.now() < deadline) {
      try { holder = JSON.parse(await readFile(join(dir, 'holder.json'), 'utf8')); } catch {}
      try { result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(holder && holder.fixturePath === join(dir, 'hold.cjs'), 'own fixture must have started');
    assert.equal(alive(holder.parentPid), false, 'cmd launcher must already have exited');
    assert.equal(alive(holder.pid), true, 'tool must not kill the launched app');
    assert.equal(Boolean(result), !expectHang, 'completion must match expected old/new behavior');
    if (result) {
      const output = typeof result.result === 'string' ? result.result : result.result.output;
      assert.match(output, /输出管道/); assert.ok(result.returnedAt - start < 2500);
    }
    results.push({ entry, hung: !result, elapsedMs: Date.now() - start, launcherExited: true, launchedChildPreserved: true });
  } finally {
    // These exact PIDs belong to our harness and nonce-qualified fixture, never a user's browser.
    if (holder?.fixturePath === join(dir, 'hold.cjs')) await killOwned(holder.pid);
    await killOwned(parent?.pid);
    assert.equal(holder ? alive(holder.pid) : false, false, 'owned fixture cleanup');
    await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
console.log(JSON.stringify({ platform: process.platform, node: process.version, expectHang, results, ownedProcessesCleaned: true }, null, 2));
