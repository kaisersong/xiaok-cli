import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { ensureBundledYzjCli, getYzjCliLaunchArgs } from '../runtime/bundled-yzj-cli.js';

export async function runYzjCli(args: string[]): Promise<number> {
  const cli = ensureBundledYzjCli();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...getYzjCliLaunchArgs(cli), ...args], {
      shell: false, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const onInterrupt = () => { child.kill('SIGINT'); };
    const onTerminate = () => { child.kill('SIGTERM'); };
    const cleanup = () => {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)); });
  });
}

export function registerYzjCliCommand(program: Command, options: {
  run?: (args: string[]) => Promise<number>;
  setExitCode?: (code: number) => void;
} = {}): void {
  // Stop the parent from consuming the upstream CLI's --help / --version.
  program.enablePositionalOptions();
  program.command('yzj-cli')
    .description('运行内置云之家 CLI（消息、日程、通讯录等；update 可独立更新）')
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .argument('[args...]')
    .action(async (args: string[]) => {
      const code = await (options.run ?? runYzjCli)(args);
      (options.setExitCode ?? (code => { process.exitCode = code; }))(code);
    });
}
