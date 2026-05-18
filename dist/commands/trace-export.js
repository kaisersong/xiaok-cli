import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { validateTraceBundle } from '../runtime/trace/schema.js';
import { buildProjectTraceBundleFromKSwarmDetail, buildSessionTraceBundleFromSnapshots, loadTaskSnapshotsForSession, writeTraceBundleToPath, } from '../runtime/trace/exporter.js';
export async function runTraceExportCommand(input) {
    if (input.sessionId) {
        const dataRoot = input.dataRoot ?? join(homedir(), '.xiaok', 'desktop');
        const snapshots = loadTaskSnapshotsForSession({ dataRoot, sessionId: input.sessionId });
        if (snapshots.length === 0) {
            throw new Error(`no snapshots found for session: ${input.sessionId}`);
        }
        const bundle = buildSessionTraceBundleFromSnapshots(snapshots, { sessionId: input.sessionId, dataRoot });
        return writeTraceBundleToPath({ bundle, outputPath: input.outputPath, force: input.force });
    }
    if (input.projectId) {
        if (!input.projectDetailPath) {
            throw new Error('project trace export requires projectDetailPath outside desktop IPC');
        }
        const detail = JSON.parse(readFileSync(input.projectDetailPath, 'utf8'));
        const bundle = buildProjectTraceBundleFromKSwarmDetail(detail, { projectId: input.projectId });
        return writeTraceBundleToPath({ bundle, outputPath: input.outputPath, force: input.force });
    }
    if (!input.inputPath) {
        throw new Error('trace export requires --input, --session, or --project');
    }
    if (existsSync(input.outputPath) && !input.force) {
        throw new Error(`output already exists: ${input.outputPath}`);
    }
    const bundle = JSON.parse(readFileSync(input.inputPath, 'utf8'));
    const validation = validateTraceBundle(bundle);
    if (!validation.ok) {
        throw new Error(`invalid trace bundle: ${validation.errors.join(', ')}`);
    }
    copyFileSync(input.inputPath, input.outputPath);
    return input.outputPath;
}
export function registerTraceCommands(program) {
    const trace = program.command('trace').description('管理 xiaok trace bundle');
    trace
        .command('export')
        .description('导出已生成的 trace bundle')
        .option('--input <path>', '输入 Trace Bundle JSON 文件路径')
        .option('--session <sessionId>', '从 Desktop task snapshots 导出指定 session trace')
        .option('--project <projectId>', '从 KSwarm full-detail snapshot 导出指定 project trace')
        .option('--data-root <path>', 'Desktop data root，默认 ~/.xiaok/desktop')
        .option('--project-detail <path>', 'KSwarm /projects/:id/full JSON snapshot 路径')
        .requiredOption('--output <path>', '输出文件路径')
        .option('--force', '允许覆盖已存在输出文件', false)
        .action(async (options) => {
        const output = await runTraceExportCommand({
            inputPath: options.input,
            sessionId: options.session,
            projectId: options.project,
            dataRoot: options.dataRoot,
            projectDetailPath: options.projectDetail,
            outputPath: options.output,
            force: Boolean(options.force),
        });
        console.log(output);
    });
}
