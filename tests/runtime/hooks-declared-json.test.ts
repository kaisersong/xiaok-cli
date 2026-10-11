import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHooksRunner, type HookConfig, type HookEventName } from '../../src/runtime/hooks-runner.js';
import { parsePluginManifest } from '../../src/platform/plugins/manifest.js';
import { loadPlatformPluginRuntime } from '../../src/platform/plugins/runtime.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';
import { PermissionManager } from '../../src/ai/permissions/manager.js';

const roots: string[] = [];
const runners: ReturnType<typeof createHooksRunner>[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.closeAndDrain();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  vi.unstubAllEnvs();
});
function root() { const value = mkdtempSync(join(tmpdir(), 'hook json ')); roots.push(value); return value; }
function command(stdout: string, exitCode = 0, marker?: string) {
  const script = join(root(), process.platform === 'win32' ? 'hook %NOT_A_VARIABLE% test.cjs' : 'hook test.cjs');
  writeFileSync(script, `process.stdin.resume();${marker ? `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');` : ''}process.stdout.write(${JSON.stringify(stdout)});process.exitCode=${exitCode};`);
  if (process.platform === 'win32') {
    vi.stubEnv('XIAOK_HOOK_TEST_NODE', process.execPath);
    vi.stubEnv('XIAOK_HOOK_TEST_SCRIPT', script);
    return '"%XIAOK_HOOK_TEST_NODE%" "%XIAOK_HOOK_TEST_SCRIPT%"';
  }
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  return `${quote(process.execPath)} ${quote(script)}`;
}
function runner(hook: HookConfig) { const value = createHooksRunner({ hooks: [hook] }); runners.push(value); return value; }
const jsonConfig = (cmd: string, event: HookEventName = 'PreToolUse') => ({ command: cmd, outputFormat: 'json', events: [event] }) as HookConfig;
const blocking: HookEventName[] = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'PermissionRequest'];
it.each(blocking)('rejects real malformed stdout on %s', async event => {
  expect(await runner(jsonConfig(command('{bad'), event)).runHooks(event, {})).toMatchObject({ ok: false, preventContinuation: true, decision: 'deny', message: 'hook_invalid_json_output' });
});
it.each(['', 'null', '[]', '1', '"plain"', '{} trailing', '{"updatedInput":null}', '{"updatedInput":[]}', '{"preventContinuation":1}', '{"additionalContext":3}', '{"decision":"maybe"}', '{"message":{}}', '{"reason":1}', '{"ok":"false"}'])('rejects declared invalid object/schema %s', async stdout => {
  expect(await runner(jsonConfig(command(stdout))).runPreHooks('probe', {})).toMatchObject({ ok: false, message: 'hook_invalid_json_output' });
});
it('preserves declared valid JSON controls and extensions', async () => {
  const result = await runner(jsonConfig(command(JSON.stringify({ updatedInput: { x: 1 }, preventContinuation: true, additionalContext: 'context', decision: 'deny', message: 'explanation', future: { a: 1 } })))).runPreHooks('probe', {});
  expect(result).toMatchObject({ ok: true, updatedInput: { x: 1 }, preventContinuation: true, additionalContext: 'context', decision: 'deny', message: 'explanation' });
});
it.each(['plain stdout', '{bad', '{"updatedInput":3,"decision":"future","preventContinuation":"yes"}'])('keeps legacy output behavior %s', async stdout => {
  const result = await runner({ command: command(stdout) }).runPreHooks('probe', {});
  expect(result.ok).toBe(true);
  if (stdout.startsWith('{"')) expect(result).toMatchObject({ updatedInput: {}, decision: 'future', preventContinuation: true });
});
it('warns without propagating controls for nonblocking malformed JSON', async () => {
  const result = await runner(jsonConfig(command('{bad'), 'SessionStart')).runHooks('SessionStart', {});
  expect(result).toEqual({ ok: true, message: 'hook_invalid_json_output' });
});
it.each([1, 2])('retains declared nonzero exit semantics %s', async exit => {
  const value = runner(jsonConfig(command('{"reason":"reason"}', exit)));
  const result = await value.runPreHooks('probe', {});
  if (exit === 2) expect(result).toMatchObject({ ok: false, message: 'reason', decision: 'deny' });
  else expect(result).toMatchObject({ ok: true, message: 'Hook exited with code 1' });
});
it('validates prompt control fields before consuming ok/reason', async () => {
  const invalid = createHooksRunner({ hooks: [{ type: 'prompt', prompt: 'check', outputFormat: 'json' } as HookConfig], promptExecutor: async () => '{"ok":false,"reason":1}' }); runners.push(invalid);
  expect(await invalid.runPreHooks('probe', {})).toMatchObject({ ok: false, message: 'hook_invalid_json_output' });
  const valid = createHooksRunner({ hooks: [{ type: 'prompt', prompt: 'check', outputFormat: 'json' } as HookConfig], promptExecutor: async () => '{"ok":false,"reason":"denied"}' }); runners.push(valid);
  expect(await valid.runPreHooks('probe', {})).toMatchObject({ ok: false, decision: 'deny', message: 'denied' });
});
it('rejects actual HTTP malformed JSON', async () => {
  const server = createServer((_req, res) => res.end('{bad'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('missing port');
    expect(await runner({ type: 'http', url: `http://127.0.0.1:${address.port}`, outputFormat: 'json' } as HookConfig).runPreHooks('probe', {})).toMatchObject({ ok: false, message: 'hook_invalid_json_output' });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
it('post convenience and actual registry propagate rejection after tool execution', async () => {
  const value = runner(jsonConfig(command('{bad'), 'PostToolUse'));
  await expect(value.runPostHooks('probe', {})).rejects.toThrow('hook_invalid_json_output');
  let executions = 0;
  const registry = new ToolRegistry({ permissionManager: new PermissionManager({ mode: 'auto' }), hooksRunner: value }, [{ permission: 'safe', definition: { name: 'probe', description: 'probe', inputSchema: { type: 'object' } }, execute: async () => { executions++; return 'SUCCESS_TEXT'; } }]);
  expect(await registry.executeTool('probe', {})).toBe('Error: hook_invalid_json_output');
  expect(executions).toBe(1);
});
it.each(['command', 'http', 'prompt'] as const)('rejects direct async JSON %s before side effects', async type => {
  const marker = join(root(), 'started'); const prompt = vi.fn(async () => '{}'); let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('{}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('missing port');
    const hook = { type, command: command('{}', 0, marker), url: `http://127.0.0.1:${address.port}`, prompt: 'check', async: true, outputFormat: 'json' } as HookConfig;
    expect(() => createHooksRunner({ hooks: [hook], promptExecutor: prompt })).toThrow('hook_json_async_unsupported');
    expect(existsSync(marker)).toBe(false); expect(requests).toBe(0); expect(prompt).not.toHaveBeenCalled();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
it.each(['xml', '', null, false])('rejects invalid declared format in direct and manifest config %s', format => {
  expect(() => createHooksRunner({ hooks: [{ command: 'unused', outputFormat: format } as unknown as HookConfig] })).toThrow('hook_output_format_invalid');
  expect(() => parsePluginManifest({ name: 'probe', version: '1', hooks: [{ command: 'unused', outputFormat: format }] }, root())).toThrow('hook_output_format_invalid');
});
it.each(['command', 'http', 'prompt'] as const)('keeps JSON format through actual plugin %s conversion and rejects async before execution', async type => {
  vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
  const cwd = root(), plugin = join(cwd, '.xiaok', 'plugins', 'probe'); mkdirSync(plugin, { recursive: true });
  const marker = join(cwd, 'started'), prompt = vi.fn(async () => '{}'); let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('{}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('missing port');
    writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ name: 'probe', version: '1', hooks: [{ type, command: command('{bad', 0, marker), url: `http://127.0.0.1:${address.port}`, prompt: 'check', outputFormat: 'json', async: true }] }));
    const state = await loadPlatformPluginRuntime(cwd, []);
    expect(state.hookConfigs).toHaveLength(1); expect(state.hookConfigs[0]).toMatchObject({ type, outputFormat: 'json' });
    expect(() => createHooksRunner({ hooks: state.hookConfigs, promptExecutor: prompt })).toThrow('hook_json_async_unsupported');
    expect(existsSync(marker)).toBe(false); expect(requests).toBe(0); expect(prompt).not.toHaveBeenCalled();
    if (type === 'command') {
      const hook = state.hookConfigs[0] as HookConfig; const value = createHooksRunner({ hooks: [{ ...hook, async: false }] }); runners.push(value);
      expect(await value.runPreHooks('probe', {})).toMatchObject({ ok: false, message: 'hook_invalid_json_output' }); expect(existsSync(marker)).toBe(true);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
