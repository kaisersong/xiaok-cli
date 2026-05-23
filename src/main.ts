import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerChatCommands } from './commands/chat.js';
import { registerCommitCommands } from './commands/commit.js';
import { registerDoctorCommands } from './commands/doctor.js';
import { registerInitCommands } from './commands/init.js';
import { registerPrCommands } from './commands/pr.js';
import { registerDaemonCommands } from './commands/reminder.js';
import { registerReviewCommands } from './commands/review.js';
import { registerTranscriptCommands } from './commands/transcript.js';
import { registerYZJCommands } from './commands/yzj.js';
import { registerPluginCommands } from './commands/plugin.js';
import { registerMemoryCommands } from './commands/memory.js';
import { registerDiagnoseCommands } from './commands/diagnose.js';
import { registerTraceCommands } from './commands/trace-export.js';
import { installGlobalCrashHandlers, reportCrash, setCrashContext } from './utils/crash-reporter.js';

installGlobalCrashHandlers();

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const program = new Command();

program
  .name('xiaok')
  .description('本地优先的 AI 任务交付工作台 CLI')
  .version(version);

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
registerPluginCommands(program);
registerMemoryCommands(program);
registerTraceCommands(program);
registerDiagnoseCommands(program);

program.hook('preAction', (_thisCommand, actionCommand) => {
  setCrashContext({
    command: formatCommandPath(actionCommand),
    args: process.argv.slice(2),
    cwd: process.cwd(),
  });
});

// chat 命令注册时使用 { isDefault: true }，Commander 自动处理无子命令时的路由
// 无需额外 program.action() — 会导致双重调用
try {
  await program.parseAsync();
} catch (error) {
  const path = await reportCrash(error);
  console.error(`运行中断，崩溃报告已保存: ${path}`);
  process.exit(1);
}

function formatCommandPath(command: Command): string {
  const parts: string[] = [];
  let current: Command | null = command;
  while (current) {
    const name = current.name();
    if (name && name !== program.name()) {
      parts.push(name);
    }
    current = current.parent ?? null;
  }
  return parts.reverse().join(' ') || program.name();
}
