import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerAuthCommands } from '../../src/commands/auth.js';
import { registerChatCommands } from '../../src/commands/chat.js';
import { registerCommitCommands } from '../../src/commands/commit.js';
import { registerConfigCommands } from '../../src/commands/config.js';
import { registerDaemonCommands } from '../../src/commands/reminder.js';
import { registerDoctorCommands } from '../../src/commands/doctor.js';
import { registerInitCommands } from '../../src/commands/init.js';
import { registerPrCommands } from '../../src/commands/pr.js';
import { registerReviewCommands } from '../../src/commands/review.js';
import { registerTranscriptCommands } from '../../src/commands/transcript.js';
import { registerYZJCommands } from '../../src/commands/yzj.js';

describe('CLI help positioning', () => {
  it('keeps the root CLI description aligned with the task-delivery positioning', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8');

    expect(source).toContain(".description('本地优先的 AI 任务交付工作台 CLI')");
  });

  it('registers top-level command descriptions with task-delivery and skill-workbench wording', () => {
    const program = new Command();

    registerAuthCommands(program);
    registerConfigCommands(program);
    registerCommitCommands(program);
    registerDaemonCommands(program);
    registerDoctorCommands(program);
    registerInitCommands(program);
    registerPrCommands(program);
    registerReviewCommands(program);
    registerTranscriptCommands(program);
    registerChatCommands(program);
    registerYZJCommands(program);

    const descriptions = Object.fromEntries(
      program.commands.map((command) => [command.name(), command.description()]),
    );
    const helpText = program.helpInformation();

    expect(descriptions).toMatchObject({
      auth: '管理云之家连接认证',
      config: '管理 xiaok 工作台配置',
      commit: '基于已暂存改动生成并创建 Git 提交',
      daemon: '管理本地 xiaok daemon 与后台服务',
      doctor: '检查本地 xiaok 工作台环境与配置',
      init: '初始化项目级 xiaok 工作台配置',
      pr: '为当前分支生成 PR 草稿，并在可用时调用 gh 创建 PR',
      review: '汇总当前工作区改动，生成交付前评审概览',
      transcript: '分析会话 transcript，检查交互与执行质量',
      chat: '启动 AI skill 任务交付工作台（默认命令）',
      yzjchannel: '连接云之家 IM channel 网关',
    });
    expect(helpText).toContain('启动 AI skill 任务交付工作台（默认命令）');
    expect(helpText).not.toContain('启动 AI 编程助手');
    expect(Object.values(descriptions).join('\n')).not.toContain('AI 编程助手');
  });
});
