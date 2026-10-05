import {constants as fsConstants} from 'node:fs';
import {lstat,mkdir,open as openFile} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';
import type {UserLoopTemplate} from './loop-types.js';
import type {LoopStore} from './loop-store.js';
import type {CompletionEvidenceStore} from './completion-evidence-store.js';
import {isSafeLoopOutputFileName} from './loop-output-paths.js';
export const LOOP_OUTPUT_PREVIEW_LIMIT_BYTES=256*1024;
function isRecord(value:unknown):value is Record<string,any>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
export async function openLoopOutputDirectory(loopId: string, template: UserLoopTemplate | undefined, shell: {openPath(path:string):Promise<string>}, check:()=>void): Promise<Record<string, unknown>> {
  const target = resolveUserLoopOutputTarget(loopId, template);
  if (!target.ok) return target;
  try {
    check();await mkdir(target.outputDirectory, { recursive: true });check();
    check();const error = await shell.openPath(target.outputDirectory);check();
    if (error) {
      return { ok: false, loopId, error: 'open_output_directory_failed', message: error, pathLabel: target.outputDirectory };
    }
    return { ok: true, loopId, pathLabel: target.outputDirectory };
  } catch (error) {
    check();
    return {
      ok: false,
      loopId,
      error: 'open_output_directory_failed',
      message: error instanceof Error ? error.message : String(error),
      pathLabel: target.outputDirectory,
    };
  }
}

export async function readLoopOutputPreview(loopId: string, template: UserLoopTemplate | undefined, check:()=>void, limitBytes=LOOP_OUTPUT_PREVIEW_LIMIT_BYTES): Promise<Record<string, unknown>> {
  const target = resolveUserLoopOutputTarget(loopId, template);
  if (!target.ok) return target;
  try {
    check();const symlinkCheck = await lstat(target.outputPath);check();
    if (symlinkCheck.isSymbolicLink()) {
      return { ok: false, loopId, error: 'output_file_symlink', pathLabel: target.outputPath };
    }
    if (!symlinkCheck.isFile()) {
      return { ok: false, loopId, error: 'output_not_file', pathLabel: target.outputPath };
    }
    if (symlinkCheck.size > limitBytes) {
      return {
        ok: false,
        loopId,
        error: 'output_file_too_large',
        pathLabel: target.outputPath,
        sizeBytes: symlinkCheck.size,
        limitBytes,
      };
    }

    const file = await openFile(target.outputPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      check();const fileStat = await file.stat();check();
      if(fileStat.dev!==symlinkCheck.dev||fileStat.ino!==symlinkCheck.ino)throw Error('loop_output_file_changed');
      if (!fileStat.isFile()) {
        return { ok: false, loopId, error: 'output_not_file', pathLabel: target.outputPath };
      }
      if (fileStat.size > limitBytes) {
        return {
          ok: false,
          loopId,
          error: 'output_file_too_large',
          pathLabel: target.outputPath,
          sizeBytes: fileStat.size,
          limitBytes,
        };
      }
      const buffer = Buffer.alloc(fileStat.size);
      if (fileStat.size > 0) {
        let offset=0;while(offset<buffer.length){const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,offset);check();if(!bytesRead)throw Error('loop_output_file_changed');offset+=bytesRead;}
      }
      const after=await file.stat();check();if(after.dev!==fileStat.dev||after.ino!==fileStat.ino||after.size!==fileStat.size||after.mtimeMs!==fileStat.mtimeMs||after.ctimeMs!==fileStat.ctimeMs)throw Error('loop_output_file_changed');
      if (looksBinary(buffer)) {
        return { ok: false, loopId, error: 'output_file_binary', pathLabel: target.outputPath, sizeBytes: fileStat.size };
      }
      return {
        ok: true,
        loopId,
        pathLabel: target.outputPath,
        content: buffer.toString('utf8'),
        sizeBytes: fileStat.size,
        truncated: false,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    check();
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    if (code === 'ENOENT') {
      return { ok: false, loopId, error: 'missing_output_file', pathLabel: target.outputPath };
    }
    return {
      ok: false,
      loopId,
      error: 'read_output_preview_failed',
      message: error instanceof Error ? error.message : String(error),
      pathLabel: target.outputPath,
    };
  }
}

export async function readLoopTaskResult(
  loopId: string,
  loopRuntime: {loopStore:LoopStore;evidenceStore:CompletionEvidenceStore},
  services: {recoverTask(id:string):Promise<{snapshot:unknown}>},
  check:()=>void,
): Promise<Record<string, unknown>> {
  const latestRun = loopRuntime.loopStore.listLoopRuns(loopId, 1)[0];
  if (!latestRun) return { ok: false, loopId, error: 'missing_loop_run' };
  const evidence = loopRuntime.evidenceStore
    .listEvidenceForOwner('loop_run', latestRun.id)
    .filter(record => latestRun.evidenceIds.includes(record.id));
  const taskId = evidence.map(record => readTaskIdFromMetadata(record.metadata)).find(Boolean);
  if (!taskId) {
    const fallback = evidence.find(record => record.summary.trim().length > 0)?.summary.trim();
    if (fallback) return { ok: true, loopId, runId: latestRun.id, content: fallback };
    return { ok: false, loopId, runId: latestRun.id, error: 'missing_task_result_evidence' };
  }

  try {
    const snapshot = (await services.recoverTask(taskId)).snapshot;check();
    const content = readTaskSnapshotResultSummary(snapshot);
    if (!content) {
      const fallback = evidence.find(record => record.summary.trim().length > 0)?.summary.trim();
      if (fallback) return { ok: true, loopId, runId: latestRun.id, taskId, content: fallback };
      return { ok: false, loopId, runId: latestRun.id, taskId, error: 'missing_task_result_content' };
    }
    return { ok: true, loopId, runId: latestRun.id, taskId, content };
  } catch (error) {
    check();
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    return {
      ok: false,
      loopId,
      runId: latestRun.id,
      taskId,
      error: code === 'ENOENT' ? 'missing_task_snapshot' : 'read_task_result_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTaskIdFromMetadata(metadata: Record<string, unknown>): string | undefined {
  const raw = typeof metadata.taskId === 'string'
    ? metadata.taskId
    : typeof metadata.responseId === 'string'
      ? metadata.responseId
      : '';
  const taskId = raw.trim();
  return /^[A-Za-z0-9_-]+$/.test(taskId) ? taskId : undefined;
}

function readTaskSnapshotResultSummary(snapshot: unknown): string | undefined {
  if (!isRecord(snapshot) || !isRecord(snapshot.result)) return undefined;
  const summary = snapshot.result.summary;
  return typeof summary === 'string' && summary.trim().length > 0 ? summary : undefined;
}

export function resolveUserLoopOutputTarget(
  loopId: string,
  template: UserLoopTemplate | undefined,
): { ok: true; outputDirectory: string; outputPath: string } | { ok: false; loopId: string; error: string; message?: string; pathLabel?: string } {
  if (!template) return { ok: false, loopId, error: 'loop_not_found' };
  if (!isAbsolute(template.outputDirectory)) {
    return {
      ok: false,
      loopId,
      error: 'output_directory_relative_legacy',
      pathLabel: template.outputDirectory,
    };
  }
  if (!isSafeLoopOutputFileName(template.outputFileName)) {
    return {
      ok: false,
      loopId,
      error: 'output_file_name_invalid',
      pathLabel: template.outputFileName,
    };
  }
  const outputDirectory = resolve(template.outputDirectory);
  const outputPath = resolve(outputDirectory, template.outputFileName);
  if (dirname(outputPath) !== outputDirectory) {
    return {
      ok: false,
      loopId,
      error: 'output_file_escapes_directory',
      pathLabel: outputPath,
    };
  }
  return { ok: true, outputDirectory, outputPath };
}

export function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

