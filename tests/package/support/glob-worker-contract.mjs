import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Register the same real emitted-worker contract for each build target.
export function registerEmittedGlobContract(runtime, moduleUrl) {
  test(`${runtime} actual emitted worker resolves beside its module from an unrelated cwd`, () => {
    assert.deepEqual(readFileSync(new URL('./glob-worker.mjs', moduleUrl)), readFileSync(new URL('../../../src/ai/tools/glob-worker.mjs', import.meta.url)));
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-glob-unrelated-cwd-'));
    try {
      const expected = join(dir, 'expected.txt').replace(/\\/g, '/');
      writeFileSync(join(dir, 'expected.txt'), '');
      const source = `import assert from 'node:assert/strict';
        const {createBoundedGlobRunner} = await import(${JSON.stringify(moduleUrl.href)});
        const runner = createBoundedGlobRunner();
        assert.deepEqual((await runner.search({cwd:${JSON.stringify(dir)},patterns:'*.txt'})).map(row=>row.path),[${JSON.stringify(expected)}]);
        assert.equal(runner.activeCount,0); console.log('actual_worker_exited');`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: dir, encoding: 'utf8', timeout: 15_000 });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.signal, null);
      assert.equal(child.stdout.trim(), 'actual_worker_exited');
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
  });
  test(`${runtime} relocated module fails closed when its adjacent worker asset is absent`, () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok glob missing asset-'));
    try {
      const relocated = join(root, 'xiaoK.app', 'Contents', 'Resources', 'app', 'ai', 'tools', 'bounded-glob.mjs');
      mkdirSync(dirname(relocated), { recursive: true });
      copyFileSync(moduleUrl, relocated);
      writeFileSync(join(root, 'expected.txt'), '');
      const source = `import assert from 'node:assert/strict';
        const {createBoundedGlobRunner} = await import(${JSON.stringify(pathToFileURL(relocated).href)});
        const runner = createBoundedGlobRunner();
        await assert.rejects(runner.search({cwd:${JSON.stringify(root)},patterns:'*.txt'}),/^Error: glob_worker_failed$/);
        assert.equal(runner.activeCount,0); console.log('missing_asset_rejected');`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.signal, null);
      assert.equal(child.stdout.trim(), 'missing_asset_rejected');
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });
}
