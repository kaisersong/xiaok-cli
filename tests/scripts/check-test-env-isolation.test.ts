import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// The check must really resolve and load setupFiles; it must not regress to grepping config text.
const repo = process.cwd();
const script = join(repo, 'scripts', 'check-test-env-isolation.mjs');
mkdirSync(join(repo, '.test-cache'), { recursive: true });
const tmp = mkdtempSync(join(repo, '.test-cache', 'env-check-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function check(name: string, config: string, runDir = repo, sandbox = false) {
  const file = join(tmp, name);
  writeFileSync(file, config);
  const result = spawnSync(process.execPath, [script, '--config', file, '--run-dir', runDir, ...(sandbox ? ['--sandbox'] : [])], { cwd: repo, encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}
const canary = "include: ['tests/support/host-env-isolation.test.ts']";

describe('check-test-env-isolation.mjs is not text matching', () => {

  it('registered sandbox configs keep sandbox:true and load as forks (#123)', async () => {
    const { REGISTERED, checkSetupFiles } = await import(join(repo, 'scripts/check-test-env-isolation.mjs'));
    const sandboxEntries = REGISTERED.filter((entry: { sandbox?: boolean }) => entry.sandbox);
    expect(sandboxEntries.map((e: { config: string }) => e.config).sort()).toEqual([
      'vitest.sandbox.config.mjs',
      'vitest.skill-release.config.mjs',
      'vitest.yolo.config.mjs',
    ].sort());
    for (const entry of sandboxEntries) {
      expect(entry.sandbox).toBe(true);
      const problems = await checkSetupFiles({
        config: join(repo, entry.config),
        runDir: join(repo, entry.runDir),
        expectCompiled: true,
        sandbox: true,
      });
      expect(problems, entry.config).toEqual([]);
    }
  });

  it('rejects a loaded sandbox threads pool before running the canary (#123)', () => {
    const result = check('threads.config.mjs', `const pool = ['th', 'reads'].join(''); export default { test: { pool, setupFiles: ['./tests/support/setup-host-env.ts'] } };`, repo, true);
    expect(result.status).toBe(1);
    expect(result.out).toContain('issue #123');
    expect(result.out).toContain("test.pool must be 'forks'");
    expect(result.out).not.toContain('canary starts');
  });

  it('fails when a setupFiles entry does not exist', () => {
    const result = check('missing.config.mjs', `export default { test: { ${canary}, setupFiles: ['./tests/support/setup-host-env-DOES-NOT-EXIST.ts'] } };`);
    expect(result.status).toBe(1);
    expect(result.out).toContain('does not exist');
  });

  it('fails when a setupFiles entry resolves outside the directory vitest runs from (the Desktop CI failure)', () => {
    const result = check('outside.config.mjs', `export default { test: { ${canary}, setupFiles: ['../tests/support/setup-host-env.ts'] } };`, join(repo, 'desktop'));
    expect(result.status).toBe(1);
    expect(result.out).toContain('outside the directory vitest runs from');
  });

  it('fails when the config only mentions setup-host-env in a comment / string but registers nothing', () => {
    const result = check('textonly.config.mjs', `// setupFiles: ['./tests/support/setup-host-env.ts']\nexport default { test: { ${canary}, name: 'setup-host-env' } };`);
    expect(result.status).toBe(1);
    expect(result.out).toContain('no test.setupFiles');
  });

  it('fails when the setup file exists but does not strip the provider variables (canary sees the leak)', () => {
    const result = check('noop.config.mjs', `export default { test: { ${canary}, environment: 'node', setupFiles: ['./tests/support/host-env.ts'] } };`);
    expect(result.status).toBe(1);
    expect(result.out).toContain('canary failed');
  });

  it('passes for a config that really loads the isolation setup file', () => {
    const result = check('good.config.mjs', `export default { test: { ${canary}, environment: 'node', setupFiles: ['./tests/support/setup-host-env.ts'] } };`);
    expect(result.out).toContain('test env isolation check passed');
    expect(result.status).toBe(0);
  });
});
