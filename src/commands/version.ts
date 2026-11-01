import type { Command } from 'commander';
import { formatVersionInfo, getVersionInfo } from '../utils/version-info.js';

export function registerVersionCommand(program: Command): void {
  program.command('version').description('查看版本、构建来源和实际运行入口')
    .option('--json', '输出结构化版本信息')
    .action((options: {json?: boolean}) => {
      console.log(options.json ? JSON.stringify(getVersionInfo(), null, 2) : formatVersionInfo().trimEnd());
    });
}
