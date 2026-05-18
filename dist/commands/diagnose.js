import { readFileSync } from 'node:fs';
import { diagnoseTraceBundle, formatDiagnosisMarkdown } from '../runtime/diagnostics/diagnoser.js';
import { validateTraceBundle } from '../runtime/trace/schema.js';
export async function runDiagnoseTraceCommand(input) {
    const bundle = JSON.parse(readFileSync(input.tracePath, 'utf8'));
    const validation = validateTraceBundle(bundle);
    if (!validation.ok) {
        throw new Error(`invalid trace bundle: ${validation.errors.join(', ')}`);
    }
    const report = diagnoseTraceBundle(bundle);
    if (input.format === 'json')
        return JSON.stringify(report, null, 2);
    return formatDiagnosisMarkdown(report);
}
export function registerDiagnoseCommands(program) {
    program
        .command('diagnose')
        .description('诊断 xiaok trace bundle，解释项目或会话卡点')
        .requiredOption('--trace <path>', 'Trace Bundle JSON 文件路径')
        .option('--format <format>', '输出格式：markdown 或 json', 'markdown')
        .action(async (options) => {
        const format = options.format === 'json' ? 'json' : 'markdown';
        console.log(await runDiagnoseTraceCommand({ tracePath: options.trace, format }));
    });
}
