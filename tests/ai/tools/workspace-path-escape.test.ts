import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { createEditTool } from '../../../src/ai/tools/edit.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { createRenderUiTool } from '../../../src/ai/tools/render-ui.js';
import { createSandboxPolicy } from '../../../src/platform/sandbox/policy.js';
import type { WorkspaceToolOptions } from '../../../src/ai/tools/read.js';

// 沙箱开启时 registry-factory 给文件工具传 allowOutsideCwd: true，并用沙箱策略作 outsideCwdGuard。
// 这里按同样方式构造工具，确认符号链接越界和 `..` 越界在工具入口处也会被拒绝。
describe('workspace tools in sandbox mode reject path escapes (P0-4)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function setup() {
    const ws = mkdtempSync(join(tmpdir(), 'xiaok-ws-'));
    const out = mkdtempSync(join(tmpdir(), 'xiaok-out-'));
    dirs.push(ws, out);
    writeFileSync(join(out, 'secret.txt'), 'outside-content');
    symlinkSync(out, join(ws, 'link'));
    const policy = createSandboxPolicy({ pathAllowlist: [ws] });
    const options: WorkspaceToolOptions = {
      cwd: ws,
      allowOutsideCwd: true,
      outsideCwdGuard: (p) => policy.checkPath(p),
      artifactRoot: join(ws, '.artifacts'),
    };
    return { ws, out, options };
  }

  it('write: refuses to write through a symlink that leaves the workspace', async () => {
    const { ws, out, options } = setup();
    await expect(createWriteTool(options).execute({ file_path: join(ws, 'link', 'new.txt'), content: 'x' })).rejects.toThrow(/denied by sandbox/i);
    expect(existsSync(join(out, 'new.txt'))).toBe(false);
  });

  it('write: refuses parent traversal out of the workspace', async () => {
    const { ws, out, options } = setup();
    const name = 'escaped.txt';
    const target = join(ws, 'sub', '..', '..', basename(out), name);
    await expect(createWriteTool(options).execute({ file_path: target, content: 'x' })).rejects.toThrow(/denied by sandbox/i);
    expect(existsSync(join(out, name))).toBe(false);
  });

  it('edit: refuses to edit a file reached through an escaping symlink', async () => {
    const { ws, out, options } = setup();
    await expect(createEditTool(options).execute({ file_path: join(ws, 'link', 'secret.txt'), old_string: 'outside', new_string: 'changed' })).rejects.toThrow(/denied by sandbox/i);
    expect(readFileSync(join(out, 'secret.txt'), 'utf-8')).toBe('outside-content');
  });

  it('read: refuses to read a file reached through an escaping symlink', async () => {
    const { ws, options } = setup();
    await expect(createReadTool(options).execute({ file_path: join(ws, 'link', 'secret.txt') })).rejects.toThrow(/denied by sandbox/i);
  });

  it('render_ui: refuses an output_path that leaves the workspace through a symlink', async () => {
    const { ws, out, options } = setup();
    await expect(createRenderUiTool(options).execute({
      title: 'T',
      sections: [{ kind: 'divider' }],
      output_path: join(ws, 'link', 'ui.a2ui.json'),
    })).rejects.toThrow(/denied by sandbox/i);
    expect(existsSync(join(out, 'ui.a2ui.json'))).toBe(false);
  });

  it('edit/read/render_ui: refuse parent traversal out of the workspace', async () => {
    const { ws, out, options } = setup();
    const viaParent = (file: string) => join(ws, 'sub', '..', '..', basename(out), file);
    await expect(createEditTool(options).execute({ file_path: viaParent('secret.txt'), old_string: 'outside', new_string: 'changed' })).rejects.toThrow(/denied by sandbox/i);
    await expect(createReadTool(options).execute({ file_path: viaParent('secret.txt') })).rejects.toThrow(/denied by sandbox/i);
    await expect(createRenderUiTool(options).execute({ title: 'T', sections: [{ kind: 'divider' }], output_path: viaParent('ui.a2ui.json') })).rejects.toThrow(/denied by sandbox/i);
    expect(readFileSync(join(out, 'secret.txt'), 'utf-8')).toBe('outside-content');
    expect(existsSync(join(out, 'ui.a2ui.json'))).toBe(false);
  });

  it('legitimate in-workspace operations still work for all four tools', async () => {
    const { ws, options } = setup();
    const file = join(ws, 'src', 'a.ts');
    await createWriteTool(options).execute({ file_path: file, content: 'const a = 1;' });
    await createEditTool(options).execute({ file_path: file, old_string: 'a = 1', new_string: 'a = 2' });
    expect(readFileSync(file, 'utf-8')).toBe('const a = 2;');
    expect(String(await createReadTool(options).execute({ file_path: file }))).toContain('const a = 2;');
    const ack = JSON.parse(String(await createRenderUiTool(options).execute({
      title: 'T',
      sections: [{ kind: 'divider' }],
      output_path: join(ws, 'out', 'ui.a2ui.json'),
    })));
    expect(ack.ok).toBe(true);
    expect(existsSync(join(ws, 'out', 'ui.a2ui.json'))).toBe(true);
  });

  it('paths the user explicitly allowed through the sandbox stay readable', async () => {
    const { out, options, ws } = setup();
    const policy = createSandboxPolicy({ pathAllowlist: [ws] });
    policy.expandAllowedPaths([out]);
    const tool = createReadTool({ ...options, outsideCwdGuard: (p) => policy.checkPath(p) });
    expect(String(await tool.execute({ file_path: join(out, 'secret.txt') }))).toContain('outside-content');
  });
});
