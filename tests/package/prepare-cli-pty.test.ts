import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(platform: string, source?: string) {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-prepare-pty-'));
  dirs.push(root);
  mkdirSync(join(root, 'scripts'));
  const script = join(root, 'scripts', 'prepare-cli-pty.mjs');
  copyFileSync(join(process.cwd(), 'scripts', 'prepare-cli-pty.mjs'), script);
  const pkg = join(root, 'node_modules', 'node-pty');
  if (source !== undefined) {
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'node-pty', main: 'index.cjs' }));
    writeFileSync(join(pkg, 'index.cjs'), source);
  }
  return { pkg, run: () => spawnSync(process.execPath, ['--input-type=module', '-e',
    `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} }); await import(${JSON.stringify(pathToFileURL(script).href)});`], { encoding: 'utf8', timeout: 10000 }) };
}
describe('PTY install health check', () => {
  it('warns on Linux native load failure with actionable cause and never attempts hidden rebuilds', () => {
    const test = fixture('linux', "throw new Error('Failed to load native module: pty.node');");
    const result = test.run();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Failed to load native module: pty.node');
    expect(result.stderr).toContain('allow-scripts');
    expect(result.stderr).toContain('node-gyp');
    expect(result.stderr).toContain('C++');
    expect(result.stderr).toContain(test.pkg);
    expect(result.stderr.match(/\[xiaok\]/g)).toHaveLength(1);
  });
  it('warns if the optional module is absent', () => {
    const result = fixture('linux').run();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('node-pty');
    expect(result.stderr).toContain('--include=optional');
  });
  it('keeps healthy Linux installs quiet', () => {
    const result = fixture('linux', 'module.exports = {};').run();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
  it('checks Windows without invoking a Unix helper or compiler', () => {
    const result = fixture('win32', "throw new Error('missing conpty.node');").run();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('missing conpty.node');
    expect(result.stderr).not.toContain('C++');
  });
  it.runIf(process.platform !== 'win32')('retains macOS spawn-helper executable permission repair', () => {
    const test = fixture('darwin', 'module.exports = {};');
    const release = join(test.pkg, 'build', 'Release');
    mkdirSync(release, { recursive: true });
    const helper = join(release, 'spawn-helper');
    writeFileSync(helper, '', { mode: 0o644 });
    expect(test.run().status).toBe(0);
    expect(statSync(helper).mode & 0o111).toBe(0o111);
  });
});
