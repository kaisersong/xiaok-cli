#!/usr/bin/env node
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerChatCommands } from './commands/chat.js';
const program = new Command();
program
    .name('xiaok')
    .description('面向云之家开发者的 AI 编程助手 CLI')
    .version('0.1.0');
registerAuthCommands(program);
registerConfigCommands(program);
registerChatCommands(program);
// chat 命令注册时使用 { isDefault: true }，Commander 自动处理无子命令时的路由
// 无需额外 program.action() — 会导致双重调用
program.parse();
