import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const options = { platform: 'linux' as const, input: { isTTY: true } as any, write: vi.fn() };
const tempDirs: string[] = [];

afterEach(() => {
  vi.doUnmock('node-pty'); vi.resetModules();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('PTY native module load failures', () => {
  it.each([
    Object.assign(new Error("Cannot find package 'node-pty'"), { code: 'ERR_MODULE_NOT_FOUND' }),
    Object.assign(new Error('NODE_MODULE_VERSION mismatch'), { code: 'ERR_DLOPEN_FAILED' }),
  ])('preserves loader diagnostics without claiming reinstall is required', async (cause) => {
    // Use Node's actual import boundary; Vitest wraps factory exceptions.
    const loader = `export async function resolve(specifier, context, next) {
      if (specifier === 'node-pty') throw Object.assign(new Error(${JSON.stringify(cause.message)}), { code: ${JSON.stringify(cause.code)} });
      return next(specifier, context);
    }`;
    const fromSource = import.meta.url.endsWith('.ts');
    const entry = new URL(`../../src/commands/cli-pty-command.${fromSource ? 'ts' : 'js'}`, import.meta.url).href;
    const script = `import { runPtyCommand } from ${JSON.stringify(entry)};
      try { await runPtyCommand('true', { platform: 'linux', input: { isTTY: true }, write() {} }); }
      catch (error) { console.log(JSON.stringify({ message: error.message, cause: { message: error.cause?.message, code: error.cause?.code } })); }`;
    const home = mkdtempSync(join(tmpdir(), 'xiaok-pty-load-'));
    tempDirs.push(home);
    const result = spawnSync(process.execPath, [...(fromSource ? ['--import', 'tsx'] : []), '--no-warnings', '--loader', `data:text/javascript,${encodeURIComponent(loader)}`, '--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, XIAOK_CONFIG_DIR: join(home, '.xiaok'), HOME: home, USERPROFILE: home, TMPDIR: home, TEMP: home, TMP: home },
    });
    expect(result.status, result.stderr).toBe(0);
    const error = JSON.parse(result.stdout);
    expect(error.cause).toEqual({ message: cause.message, code: cause.code });
    expect(error.message).toContain(cause.code);
    expect(error.message).toContain(cause.message);
    expect(error.message).toContain(`linux/${process.arch}`);
    expect(error.message).toContain(process.version);
    expect(error.message).toContain(process.versions.modules);
    expect(error.message).toContain('命令尚未执行');
    expect(error.message).toContain('!<command>');
    expect(error.message).toContain('allow-scripts');
    expect(error.message).not.toContain('请重新安装');
    const persisted = readFileSync(join(home, '.xiaok', 'logs', 'xiaok.log'), 'utf8');
    expect(persisted).toContain('node-pty load failed');
    expect(persisted).toContain(cause.code);
    expect(persisted).toContain(cause.message);
    expect(persisted).toContain('modulePath');
  });

  it('preserves cancellation during a failed import', async () => {
    const controller = new AbortController();
    const reason = new DOMException('User cancelled', 'AbortError');
    vi.doMock('node-pty', () => { controller.abort(reason); throw new Error('load failed'); });
    const { runPtyCommand } = await import('../../src/commands/cli-pty-command.js');
    await expect(runPtyCommand('true', { ...options, signal: controller.signal })).rejects.toBe(reason);
  });

  it('rejects Windows and non-TTY before attempting module import', async () => {
    const loader = vi.fn(() => { throw new Error('must not load'); });
    vi.doMock('node-pty', loader);
    const { runPtyCommand } = await import('../../src/commands/cli-pty-command.js');
    await expect(runPtyCommand('true', { ...options, platform: 'win32' })).rejects.toThrow('Windows');
    await expect(runPtyCommand('true', { ...options, input: { isTTY: false } as any })).rejects.toThrow('交互终端');
    expect(loader).not.toHaveBeenCalled();
  });
});
