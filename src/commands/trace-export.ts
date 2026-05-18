import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { validateTraceBundle } from '../runtime/trace/schema.js';

export async function runTraceExportCommand(input: {
  inputPath: string;
  outputPath: string;
  force?: boolean;
}): Promise<string> {
  if (existsSync(input.outputPath) && !input.force) {
    throw new Error(`output already exists: ${input.outputPath}`);
  }
  const bundle = JSON.parse(readFileSync(input.inputPath, 'utf8')) as unknown;
  const validation = validateTraceBundle(bundle);
  if (!validation.ok) {
    throw new Error(`invalid trace bundle: ${validation.errors.join(', ')}`);
  }
  copyFileSync(input.inputPath, input.outputPath);
  return input.outputPath;
}

export function registerTraceCommands(program: Command): void {
  const trace = program.command('trace').description('管理 xiaok trace bundle');
  trace
    .command('export')
    .description('导出已生成的 trace bundle')
    .requiredOption('--input <path>', '输入 Trace Bundle JSON 文件路径')
    .requiredOption('--output <path>', '输出文件路径')
    .option('--force', '允许覆盖已存在输出文件', false)
    .action(async (options: { input: string; output: string; force?: boolean }) => {
      const output = await runTraceExportCommand({
        inputPath: options.input,
        outputPath: options.output,
        force: Boolean(options.force),
      });
      console.log(output);
    });
}
