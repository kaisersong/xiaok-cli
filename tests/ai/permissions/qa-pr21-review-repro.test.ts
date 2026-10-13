import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
describe('QA PR21 评审复现', () => {
  for (const mode of ['default', 'auto'] as const) {
    it(`${mode}: git archive -o 工作区外 应不放行`, async () => {
      const d = await new PermissionManager({ mode, allowRules: ['bash(git *)'], cwd: '/tmp/qa-ws' } as any).check('bash', { command: 'git archive -o /tmp/outside/x.zip HEAD' });
      expect(d).not.toBe('allow');
    });
    it(`${mode}: 重定向 + workdir 在工作区外 应不放行`, async () => {
      const d = await new PermissionManager({ mode, allowRules: ['bash(git *)'], cwd: '/tmp/qa-ws' } as any).check('bash', { command: 'git status > result', workdir: '/tmp/outside' });
      expect(d).not.toBe('allow');
    });
    it(`${mode}: 对照 绝对路径重定向到工作区外 不放行`, async () => {
      const d = await new PermissionManager({ mode, allowRules: ['bash(git *)'], cwd: '/tmp/qa-ws' } as any).check('bash', { command: 'git status > /tmp/outside/result' });
      expect(d).not.toBe('allow');
    });
  }
});
