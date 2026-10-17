import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_NODE_VERSION, isNodeVersionAtLeast, shouldBlockChatOnOldNode, oldNodeMessage } from '../../src/runtime/node-support.js';

describe('Node support', () => {
  it('declares the minimum version', () => {
    expect(MIN_NODE_VERSION).toBe('22.14.0');
  });

  it.each([
    ['22.13.1', false], ['22.14.0', true], ['22.14.1', true],
    ['24.0.0', true], ['24.21.0', true], ['22.12.0', false],
    ['22.5.0', false], ['20.19.2', false], ['v22.12.0', false],
    ['v22.14.0', true], ['', true], ['invalid', true], ['22.14', true],
    ['22.14.0garbage', true],
  ])('compares %s against the minimum', (version, expected) => {
    expect(isNodeVersionAtLeast(version, MIN_NODE_VERSION)).toBe(expected);
  });

  it('accepts a minimum with v prefix and fails open for invalid minima', () => {
    expect(isNodeVersionAtLeast('22.13.1', 'v22.14.0')).toBe(false);
    expect(isNodeVersionAtLeast('20.19.2', 'invalid')).toBe(true);
  });

  it.each([
    ['linux', '22.13.1', false, false, true],
    ['linux', '22.14.0', false, false, false],
    ['linux', '22.14.1', false, false, false],
    ['linux', '24.0.0', false, false, false],
    ['linux', '24.21.0', false, false, false],
    ['darwin', '22.12.0', false, false, false],
    ['win32', '22.12.0', false, false, false],
    ['linux', '22.12.0', true, false, false],
    ['linux', '22.12.0', false, true, false],
    ['linux', 'invalid', false, false, false],
  ])('gates %s %s print=%s json=%s', (platform, version, print, json, expected) => {
    expect(shouldBlockChatOnOldNode({ platform, version, print, json })).toBe(expected);
  });

  it('ignores the conversation activity environment variable', () => {
    const original = process.env.XIAOK_CONVERSATION_ACTIVITY;
    const input = { platform: 'linux', version: '22.13.1', print: false, json: false };
    try {
      delete process.env.XIAOK_CONVERSATION_ACTIVITY;
      expect(shouldBlockChatOnOldNode(input)).toBe(true);
      process.env.XIAOK_CONVERSATION_ACTIVITY = '0';
      expect(shouldBlockChatOnOldNode(input)).toBe(true);
    } finally {
      if (original === undefined) delete process.env.XIAOK_CONVERSATION_ACTIVITY;
      else process.env.XIAOK_CONVERSATION_ACTIVITY = original;
    }
  });

  it('uses the exact plain-language message', () => {
    const message = oldNodeMessage('v22.12.0');
    expect(message).toBe('xiaok 需要 Node 22.14.0 或更新版本，你现在用的是 v22.12.0。请升级 Node 后重新运行，可用 nvm 或官网安装包升级。');
    for (const forbidden of ['ERR_', 'http', '{', '}', '    at ']) {
      expect(message).not.toContain(forbidden);
    }
  });

  it('checks at the start of the chat action before crash context and runChat', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');
    const marker = '.action(async (input: string | undefined, opts: ChatOptions) => {';
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const action = source.slice(start + marker.length);
    expect(action.trimStart()).toMatch(/^if \(shouldBlockChatOnOldNode\(/);
    const guard = action.indexOf('shouldBlockChatOnOldNode(');
    expect(action.indexOf('setCrashContext(')).toBeGreaterThan(guard);
    expect(action.indexOf('runChat(')).toBeGreaterThan(guard);
    const blocked = action.slice(0, action.indexOf('setCrashContext('));
    expect(blocked).toContain("process.stderr.write(oldNodeMessage(process.version) + '\\n')");
    expect(blocked).toContain('process.exitCode = 1;');
    expect(blocked).toContain('return;');
    expect(blocked).not.toContain('throw');
  });

  it('keeps package and lockfile engines aligned', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'));
    expect(pkg.engines.node).toBe('>=22.14.0');
    expect(lock.packages[''].engines.node).toBe('>=22.14.0');
  });
});
