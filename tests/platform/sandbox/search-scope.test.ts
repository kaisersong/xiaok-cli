import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createSandboxPolicy } from '../../../src/platform/sandbox/policy.js';
import { createSandboxEnforcer } from '../../../src/platform/sandbox/enforcer.js';
import { applySandboxToTools } from '../../../src/platform/sandbox/tool-wrappers.js';
import {getSearchScope} from '../../../src/ai/tools/search-scope-context.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { grepTool } from '../../../src/ai/tools/grep.js';
import { globTool } from '../../../src/ai/tools/glob.js';

describe('native readonly search scope production boundary', () => {
  let root: string, allowed: string, outside: string, registry: ToolRegistry;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-search-scope-'));
    allowed = join(root, 'allowed'); outside = join(root, 'outside');
    mkdirSync(allowed); mkdirSync(outside); mkdirSync(join(allowed, 'denied'));
    writeFileSync(join(allowed, 'public.txt'), 'PUBLIC_MATCH');
    writeFileSync(join(outside, 'secret-name.txt'), 'PRIVATE_MATCH');
    writeFileSync(join(allowed, 'denied', 'hidden.txt'), 'DENIED_MATCH');
    const policy = createSandboxPolicy({ pathAllowlist: [allowed], pathDenylist: [join(allowed, 'denied')], network: 'deny' });
    registry = new ToolRegistry({ nativeReadonlyOnly: true },
      applySandboxToTools([grepTool, globTool], createSandboxEnforcer(policy)));
  });
  afterEach(() => { registry.dispose(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });

  it('an unrestricted ordinary wrapper preserves the underlying grep engine and does not mint a scoped context',async()=>{
    let observed:unknown='not called';
    const probe={...grepTool,execute:async(input:Record<string,unknown>,context?:Parameters<typeof grepTool.execute>[1])=>{observed=getSearchScope(context);return grepTool.execute(input,context);}};
    const [tool]=applySandboxToTools([probe],createSandboxEnforcer(createSandboxPolicy({})));
    const input={path:realpathSync(allowed),pattern:'PUBLIC_MATCH'};
    expect(await tool.execute(input)).toBe(await grepTool.execute(input));expect(observed).toBeUndefined();
  });
  it.each(['grep', 'glob'])('rejects explicit outside %s before data leaves the native tool', async name => {
    const result = await registry.executeTool(name, { path: outside, pattern: name === 'grep' ? 'PRIVATE' : '**/*' });
    expect(result).toMatch(/denied|outside|SCOPE/i);
    expect(result).not.toContain('PRIVATE_MATCH'); expect(result).not.toContain('secret-name');
  });
  it('retains permitted grep/glob positive paths and excludes denied descendants', async () => {
    const text = await registry.executeTool('grep', { path: allowed, pattern: 'MATCH' });
    expect(text).toContain('PUBLIC_MATCH'); expect(text).not.toContain('DENIED_MATCH');
    const paths = await registry.executeTool('glob', { path: allowed, pattern: '**/*' });
    expect(paths).toContain('public.txt'); expect(paths).not.toContain('hidden.txt');
  });
  it('rejects glob parent patterns and absolute patterns, even with an allowed cwd', async () => {
    for (const pattern of [join(outside, '*'), '../outside/*', '{public.txt,../outside/*}', '{public.txt,'+join(outside,'*')+'}', '@(public.txt|../outside/*)']) {
      const result = await registry.executeTool('glob', { path: allowed, pattern });
      expect(result).toMatch(/denied|outside|SCOPE|invalid/i);
      expect(result).not.toContain('secret-name');
    }
  });
  it('retains normal brace alternatives and does not allow caller denylist mutation to widen scope',async()=>{
    const paths=await registry.executeTool('glob',{path:allowed,pattern:'{public,missing}/*.txt'});
    expect(paths).not.toMatch(/invalid_pattern/);
    const deny=[join(allowed,'denied')];
    const policy=createSandboxPolicy({pathAllowlist:[allowed],pathDenylist:deny});
    const [wrapped]=applySandboxToTools([grepTool],createSandboxEnforcer(policy));
    deny.length=0;
    expect(policy.checkPath(join(allowed,'denied','hidden.txt')).allowed).toBe(false);
    expect(await wrapped.execute({path:allowed,pattern:'DENIED'})).not.toContain('DENIED_MATCH');
  });
  it('does not reinterpret an approved root after it is replaced by an outside link',async()=>{
    const policy=createSandboxPolicy({pathAllowlist:[allowed]});
    const [tool]=applySandboxToTools([grepTool],createSandboxEnforcer(policy));
    renameSync(allowed,join(root,'previous-allowed'));
    symlinkSync(outside,allowed,process.platform==='win32'?'junction':'dir');
    const result=await tool.execute({path:allowed,pattern:'PRIVATE'});
    expect(result).toMatch(/denied/);expect(result).not.toContain('PRIVATE_MATCH');
  });
  it('does not read a symlink outside via grep, fallback or a literal glob base', async () => {
    symlinkSync(outside, join(allowed, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(join(outside, 'secret-name.txt'), join(allowed, 'linked.txt'), 'file');
    const result = await registry.executeTool('grep', { path: allowed, pattern: 'PRIVATE' });
    expect(result).not.toContain('PRIVATE_MATCH');
    const names = await registry.executeTool('glob', { path: allowed, pattern: 'escape/**/*' });
    expect(names).not.toContain('secret-name');
    const explicit = await registry.executeTool('grep', { path: join(allowed, 'linked.txt'), pattern: 'PRIVATE' });
    expect(explicit).toMatch(/denied|outside|SCOPE/i);
    expect(explicit).not.toContain('PRIVATE_MATCH');
  });
  it('checks the actual default cwd and does not let model input mint a search capability', async () => {
    const result = await registry.executeTool('grep', {
      pattern: 'PRIVATE', path: outside, searchScope: { roots: [root] }, allowOutsideCwd: true,
    });
    expect(result).toMatch(/denied|outside|SCOPE/i);
    const omitted = await registry.executeTool('glob', { pattern: relative(process.cwd(), outside) });
    expect(omitted).not.toContain('secret-name');
  });
  it('bounds scoped grep bytes and keeps cancellation responsive to a pathological regex', async () => {
    writeFileSync(join(allowed, 'large.txt'), Buffer.alloc(4 * 1024 * 1024 + 1, 65));
    const tooLarge = await registry.executeTool('grep', { path: join(allowed, 'large.txt'), pattern: 'A' });
    expect(tooLarge).toMatch(/grep_scan_limit/);
    rmSync(join(allowed, 'large.txt'));
    writeFileSync(join(allowed, 'regex.txt'), 'a'.repeat(50000) + '!');
    const controller = new AbortController();
    const scoped = applySandboxToTools([grepTool], createSandboxEnforcer(createSandboxPolicy({
      pathAllowlist: [allowed], network: 'deny',
    })))[0];
    const timer = setTimeout(() => controller.abort(new Error('test_abort')), 300);
    try {
      await expect(scoped.execute({ path: allowed, pattern: '(a+)+$' }, { signal: controller.signal })).rejects.toThrow('test_abort');
    } finally { clearTimeout(timer); }
  });

});
