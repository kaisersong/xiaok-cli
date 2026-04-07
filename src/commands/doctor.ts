import type { Command } from 'commander';
import { existsSync } from 'fs';
import { loadConfig, getConfigPath } from '../utils/config.js';
import { loadCredentials } from '../auth/token-store.js';
import { getCurrentBranch, isGitDirty } from '../utils/git.js';

export async function runDoctorCommand(cwd: string): Promise<string> {
  const config = await loadConfig();
  const credentials = await loadCredentials();
  const configPath = getConfigPath();
  const branch = await getCurrentBranch(cwd);
  const dirty = branch ? await isGitDirty(cwd) : false;

  return [
    'Doctor Report',
    '',
    'Config',
    `- path=${configPath}`,
    `- exists=${existsSync(configPath) ? 'yes' : 'no'}`,
    `- defaultModel=${config.defaultModel}`,
    '',
    'Credentials',
    `- loggedIn=${credentials ? 'yes' : 'no'}`,
    `- enterpriseId=${credentials?.enterpriseId ?? '(none)'}`,
    '',
    'Git',
    `- repo=${branch ? 'yes' : 'no'}`,
    `- branch=${branch || '(none)'}`,
    `- dirty=${branch ? (dirty ? 'yes' : 'no') : '(n/a)'}`,
  ].join('\n');
}

export function registerDoctorCommands(program: Command): void {
  program
    .command('doctor')
    .description('检查本地 xiaok CLI 环境')
    .action(async () => {
      console.log(await runDoctorCommand(process.cwd()));
    });
}
