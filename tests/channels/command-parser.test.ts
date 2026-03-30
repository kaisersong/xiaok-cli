import { describe, expect, it } from 'vitest';
import { parseYZJCommand } from '../../src/channels/command-parser.js';

describe('parseYZJCommand', () => {
  it('treats non-slash text as plain input', () => {
    expect(parseYZJCommand('帮我看一下构建错误')).toEqual({
      kind: 'plain',
      text: '帮我看一下构建错误',
    });
  });

  it('parses help and status commands', () => {
    expect(parseYZJCommand('/help')).toEqual({ kind: 'help' });
    expect(parseYZJCommand('/status task_9')).toEqual({
      kind: 'status',
      taskId: 'task_9',
    });
    expect(parseYZJCommand('/status')).toEqual({
      kind: 'status',
      taskId: undefined,
    });
  });

  it('parses cancel and skill commands', () => {
    expect(parseYZJCommand('/cancel task_3')).toEqual({
      kind: 'cancel',
      taskId: 'task_3',
    });
    expect(parseYZJCommand('/skill review 当前分支是否可合并')).toEqual({
      kind: 'skill',
      skillName: 'review',
      args: '当前分支是否可合并',
    });
  });

  it('falls back to help for malformed control commands', () => {
    expect(parseYZJCommand('/cancel')).toEqual({ kind: 'help' });
    expect(parseYZJCommand('/skill')).toEqual({ kind: 'help' });
    expect(parseYZJCommand('/')).toEqual({ kind: 'help' });
  });

  it('keeps unknown slash commands as plain input', () => {
    expect(parseYZJCommand('/review api layer')).toEqual({
      kind: 'plain',
      text: '/review api layer',
    });
  });
});
