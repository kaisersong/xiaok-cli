#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerChatCommands } from './commands/chat.js';
import { registerCommitCommands } from './commands/commit.js';
import { registerDoctorCommands } from './commands/doctor.js';
import { registerInitCommands } from './commands/init.js';
import { registerPrCommands } from './commands/pr.js';
import { registerReviewCommands } from './commands/review.js';
import { registerTranscriptCommands } from './commands/transcript.js';
import { registerYZJCommands } from './commands/yzj.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const program = new Command();

program
  .name('xiaok')
  .description('面向云之家开发者的 AI 编程助手 CLI')
  .version(version);

registerAuthCommands(program);
registerConfigCommands(program);
registerCommitCommands(program);
registerDoctorCommands(program);
registerInitCommands(program);
registerPrCommands(program);
registerReviewCommands(program);
registerTranscriptCommands(program);
registerChatCommands(program);
registerYZJCommands(program);

// chat 命令注册时使用 { isDefault: true }，Commander 自动处理无子命令时的路由
// 无需额外 program.action() — 会导致双重调用

program.parse();
