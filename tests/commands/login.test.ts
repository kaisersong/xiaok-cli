/**
 * `xiaok login` contract tests — provider key setup flow
 * (first-run friendly entry modeled after opencode/kimi-code login).
 *
 * Invariants:
 *   - persists providers.<id>.apiKey and keeps first_party protocol/baseUrl
 *   - preserves pre-existing custom baseUrl/headers on re-login
 *   - registers the provider's default model entry and flips
 *     defaultProvider/defaultModelId when the user opts in
 *   - unknown provider fails closed with the available list
 *   - env-var candidates are reused when the user enters nothing
 *   - verification probe is called unless --skip-verify
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {createTtyHarness} from '../support/tty.js';
import {waitFor} from '../support/wait-for.js';

const probeMock = vi.fn();

vi.mock('../../src/ai/providers/key-probe.js', () => ({
  probeApiKey: probeMock,
}));

const { consumeSecretInputChunk, runLoginCommand } = await import('../../src/commands/login.js');
const { loadConfig } = await import('../../src/utils/config.js');

describe('xiaok login command', () => {
  let configDir: string;
  let originalConfigDir: string | undefined;
  let originalArgv: string[];

  beforeEach(() => {
    configDir = join(tmpdir(), `xiaok-login-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
    originalArgv = process.argv;
    process.env.XIAOK_CONFIG_DIR = configDir;
    probeMock.mockReset();
    probeMock.mockResolvedValue({ status: 'valid' });
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
    }
    process.argv = originalArgv;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.XIAOK_DEEPSEEK_API_KEY;
    vi.clearAllMocks();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(configDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  function readSavedConfig() {
    return JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'));
  }

  it.each(['kimi','glm','minimax'])('selects a Coding Plan interactively without echoing %s secret', async provider => {
    const harness=createTtyHarness(100,24);
    const key='test-hidden-plan-secret';
    try {
      const pending=runLoginCommand({provider,setDefault:true});
      await waitFor(()=>expect(harness.output.normalized).toContain('输入编号或服务 id'));
      harness.send('1\r');
      await waitFor(()=>expect(harness.output.normalized).toContain('输入时不可见'));
      harness.send(key+'\r');
      expect((await pending).status).toBe('saved');
      expect(harness.output.normalized).not.toContain(key);
      expect(readSavedConfig().providers[provider].apiKey).toBe(key);
      expect(process.stdin.isRaw).not.toBe(true);
    } finally {harness.restore();}
  });

  it('keeps Windows raw input owned until the login-to-chat handoff finishes', async () => {
    const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!;
    const originalRaw=process.stdin.isRaw;
    const harness=createTtyHarness(100,24);
    Object.defineProperty(process,'platform',{...descriptor,value:'win32'});
    const setRaw=vi.mocked(process.stdin.setRawMode).mockImplementation(raw=>{process.stdin.isRaw=raw;return process.stdin;});
    try {
      process.stdin.isRaw=false;
      const pending=runLoginCommand({provider:'kimi',setDefault:true});
      await waitFor(()=>expect(harness.output.normalized).toContain('输入编号或服务 id'));
      harness.send('coding\r');
      await waitFor(()=>expect(harness.output.normalized).toContain('输入时不可见'));
      expect(setRaw.mock.calls.some(([raw])=>raw===false)).toBe(false);
      harness.send('test-windows-hidden-key\r');
      expect((await pending).status).toBe('saved');
      expect(process.stdin.isRaw).toBe(false);
      expect(setRaw.mock.calls.at(-1)).toEqual([false]);
      expect(harness.output.normalized).not.toContain('test-windows-hidden-key');
    } finally {Object.defineProperty(process,'platform',descriptor);harness.restore();process.stdin.isRaw=originalRaw;}
  });

  it.each(['\u0003','EOF'])('cleans up hidden input on %s without saving credentials', async action => {
    const harness=createTtyHarness(100,24);
    try {
      const pending=runLoginCommand({provider:'kimi',plan:'coding',setDefault:true} as Parameters<typeof runLoginCommand>[0] & {plan:string});
      await waitFor(()=>expect(harness.output.normalized).toContain('输入时不可见'));
      if(action==='EOF') harness.emitter.emit('end'); else harness.send(action);
      expect(await pending).toEqual({status:'cancelled'});
      expect(existsSync(join(configDir,'config.json'))).toBe(false);
      expect(process.stdin.isRaw).not.toBe(true);
    } finally {harness.restore();}
  });

  it('submits a pasted secret when the key and carriage return share one input chunk', () => {
    expect(consumeSecretInputChunk('', Buffer.from('sk-pasted-key\r'))).toEqual({
      action: 'submit',
      value: 'sk-pasted-key',
    });
  });

  it.each([
    ['kimi','coding','https://api.kimi.com/coding/v1','k3'],
    ['kimi','api','https://api.moonshot.cn/v1','kimi-k2.6'],
    ['glm','coding','https://open.bigmodel.cn/api/coding/paas/v4','GLM-5.3'],
    ['glm','api','https://open.bigmodel.cn/api/paas/v4','GLM-5.2'],
    ['minimax','coding','https://api.minimax.io/v1','MiniMax-M3'],
  ])('selects matching endpoint and model for %s %s', async (provider,plan,baseUrl,model) => {
    const result = await runLoginCommand({provider,plan,apiKey:'test-plan-key',setDefault:true} as Parameters<typeof runLoginCommand>[0] & {plan:string});
    expect(result.status).toBe('saved');
    const saved = readSavedConfig();
    expect(saved.providers[provider].baseUrl).toBe(baseUrl);
    expect(saved.models[saved.defaultModelId].model).toBe(model);
    expect(probeMock.mock.calls[0].slice(0,3)).toEqual(['openai_legacy',baseUrl,'test-plan-key']);
  });

  it('explicit plan switches away from an existing incompatible endpoint', async () => {
    await runLoginCommand({provider:'kimi',apiKey:'old',setDefault:true,skipVerify:true});
    await runLoginCommand({provider:'kimi',plan:'api',apiKey:'new',setDefault:true} as Parameters<typeof runLoginCommand>[0] & {plan:string});
    const saved=readSavedConfig();
    expect(saved.providers.kimi.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(saved.models[saved.defaultModelId].model).toBe('kimi-k2.6');
  });

  it('probes the preserved custom endpoint rather than the catalog endpoint', async () => {
    const initial=await loadConfig();
    initial.providers.deepseek={type:'first_party',protocol:'openai_legacy',baseUrl:'https://proxy.example.com/v1'};
    const {saveConfig}=await import('../../src/utils/config.js');
    await saveConfig(initial);
    await runLoginCommand({provider:'deepseek',apiKey:'test-proxy'});
    expect(probeMock.mock.calls[0][1]).toBe('https://proxy.example.com/v1');
  });

  it.each([['glm','invalid'],['deepseek','coding']])('rejects unsupported %s plan %s without saving a key', async (provider,plan) => {
    const result=await runLoginCommand({provider,plan,apiKey:'test-bad-plan',skipVerify:true} as Parameters<typeof runLoginCommand>[0] & {plan:string});
    expect(result.status).toBe('cancelled');
    expect(existsSync(join(configDir,'config.json'))).toBe(false);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('persists the api key and switches the default model when requested', async () => {
    const result = await runLoginCommand({
      provider: 'deepseek',
      apiKey: 'sk-test-deepseek',
      setDefault: true,
    });

    const saved = readSavedConfig();
    expect(saved.providers.deepseek).toMatchObject({
      type: 'first_party',
      protocol: 'openai_legacy',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-deepseek',
    });
    expect(saved.defaultProvider).toBe('deepseek');
    expect(saved.defaultModelId).toBe('deepseek-default');
    expect(saved.models['deepseek-default']).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    });
    expect(result).toEqual({ status: 'saved', providerId: 'deepseek' });
    expect(probeMock).toHaveBeenCalledOnce();
  });

  it('does not switch the default model without opt-in', async () => {
    const before = (await loadConfig()).defaultProvider;
    await runLoginCommand({ provider: 'glm', apiKey: 'sk-glm', skipVerify: true });

    const saved = readSavedConfig();
    expect(saved.providers.glm.apiKey).toBe('sk-glm');
    expect(saved.defaultProvider).toBe(before);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('preserves an existing custom baseUrl and headers on re-login', async () => {
    const initial = await loadConfig();
    initial.providers.deepseek = {
      type: 'first_party',
      protocol: 'openai_legacy',
      baseUrl: 'https://my-proxy.example.com/v1',
      headers: { 'x-custom': '1' },
      apiKey: 'sk-old',
    };
    const { saveConfig } = await import('../../src/utils/config.js');
    await saveConfig(initial);

    await runLoginCommand({ provider: 'deepseek', apiKey: 'sk-new', skipVerify: true });

    const saved = readSavedConfig();
    expect(saved.providers.deepseek.apiKey).toBe('sk-new');
    expect(saved.providers.deepseek.baseUrl).toBe('https://my-proxy.example.com/v1');
    expect(saved.providers.deepseek.headers).toEqual({ 'x-custom': '1' });
  });

  it('fails closed for unknown providers and lists the valid ids', async () => {
    const logged: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logged.push(String(line));
    });
    try {
      const result = await runLoginCommand({ provider: 'not-a-provider', apiKey: 'sk-x', skipVerify: true });
      expect(result).toEqual({ status: 'cancelled' });
    } finally {
      consoleSpy.mockRestore();
    }
    expect(logged.some((line) => line.includes('未知 provider') && line.includes('deepseek'))).toBe(true);
    // no config file gets written on failure
    expect(existsSync(join(configDir, 'config.json'))).toBe(false);
  });

  it('reuses an env-var candidate when the user enters no key', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-from-env';
    // simulate interactive empty input via piped stdin
    const originalStdin = process.stdin;
    // runLoginCommand reads via readline on process.stdin; in tests stdin is
    // not a TTY so promptSecret falls back to a line read. We feed nothing
    // (EOF) which resolves to '' and reuses the env candidate.
    await runLoginCommand({ provider: 'deepseek', skipVerify: true });

    const saved = readSavedConfig();
    expect(saved.providers.deepseek.apiKey).toBe('sk-from-env');
    void originalStdin;
  });

  it('still saves the key when verification reports an invalid key', async () => {
    probeMock.mockResolvedValue({ status: 'invalid', httpStatus: 401, detail: '401' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runLoginCommand({ provider: 'kimi', apiKey: 'sk-bad' });
    } finally {
      consoleSpy.mockRestore();
    }
    const saved = readSavedConfig();
    expect(saved.providers.kimi.apiKey).toBe('sk-bad');
  });
});
