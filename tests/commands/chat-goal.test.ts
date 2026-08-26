import { describe, expect, it } from 'vitest';
import {
  buildGoalContinuationInput,
  formatGoalStatus,
  inferGoalInput,
  isUnsupportedSingleShotGoalInput,
  parseGoalSlashCommand,
} from '../../src/commands/chat-goal.js';
import { createGoalState } from '../../src/runtime/goal/reducer.js';

describe('chat Goal command contract', () => {
  it('parses only the documented Goal slash commands', () => {
    expect(parseGoalSlashCommand('/goal 修复登录并运行测试')).toEqual({
      kind: 'create', objective: '修复登录并运行测试',
    });
    expect(parseGoalSlashCommand('/goal replace 重新实现登录')).toEqual({
      kind: 'replace', objective: '重新实现登录',
    });
    expect(parseGoalSlashCommand('/goal status')).toEqual({ kind: 'status' });
    expect(parseGoalSlashCommand('/goal pause')).toEqual({ kind: 'pause' });
    expect(parseGoalSlashCommand('/goal resume')).toEqual({ kind: 'resume' });
    expect(parseGoalSlashCommand('/goal resume 25')).toEqual({ kind: 'resume', turnLimit: 25 });
    expect(parseGoalSlashCommand('/goal resume nope')).toMatchObject({ kind: 'invalid' });
    expect(parseGoalSlashCommand('/goal cancel')).toEqual({ kind: 'cancel' });
    expect(parseGoalSlashCommand('/goal')).toEqual({ kind: 'help' });
    expect(parseGoalSlashCommand('/skills')).toBeNull();
  });

  it('freezes a conservative evidence policy from the user objective', () => {
    expect(inferGoalInput('解释 Goal 的工作方式')).toMatchObject({
      expectedEvidenceKinds: ['answer'], turnLimit: 20,
    });
    expect(inferGoalInput('修改登录代码')).toMatchObject({
      expectedEvidenceKinds: ['file_artifact'],
    });
    expect(inferGoalInput('修复登录并运行测试')).toMatchObject({
      expectedEvidenceKinds: ['file_artifact', 'command_action'],
    });
  });

  it('rejects Goal commands before single-shot input reaches the model', () => {
    expect(isUnsupportedSingleShotGoalInput('/goal 写完这个功能')).toBe(true);
    expect(isUnsupportedSingleShotGoalInput(' /goal status ')).toBe(true);
    expect(isUnsupportedSingleShotGoalInput('解释 /goal')).toBe(false);
  });

  it('formats durable status and uses a non-user continuation trigger', () => {
    const state = createGoalState({
      sessionId: 's1', objective: '完成登录修复', completionCriterion: '测试通过',
      expectedEvidenceKinds: ['file_artifact', 'command_action'], turnLimit: 8, now: 1,
    });
    expect(formatGoalStatus(state)).toContain('Goal · active · 0/8 turns');
    expect(formatGoalStatus(state)).toContain('测试通过');
    expect(buildGoalContinuationInput(state)).toMatchObject({ systemTrigger: 'goal_continuation' });
    expect(buildGoalContinuationInput(state).prompt).not.toContain('用户说');
  });
});
