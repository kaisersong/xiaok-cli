import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_PROJECT_SETTINGS = {
  permissions: {
    allow: [],
    deny: [],
  },
  ui: {
    statusBar: {
      fields: ['model', 'mode', 'tokens', 'session'],
    },
  },
  hooks: {
    pre: [],
    post: [],
    timeoutMs: 5000,
  },
};

export async function runInitCommand(cwd: string): Promise<string> {
  const projectDir = join(cwd, '.xiaok');
  const settingsPath = join(projectDir, 'settings.json');

  mkdirSync(projectDir, { recursive: true });
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, JSON.stringify(DEFAULT_PROJECT_SETTINGS, null, 2) + '\n', 'utf8');
  }

  return `已初始化项目配置：${settingsPath}`;
}

export function registerInitCommands(program: Command): void {
  program
    .command('init')
    .description('初始化项目级 xiaok 配置')
    .action(async () => {
      console.log(await runInitCommand(process.cwd()));
    });
}
