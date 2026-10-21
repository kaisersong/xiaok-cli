import {statSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {isSafeLoopOutputFileName} from './loop-output-paths.js';
import type {UserLoopTemplate} from './loop-types.js';
export function resolveUserLoopOutputTarget(template: UserLoopTemplate):
  | { ok: true; outputDirectory: string; outputPath: string }
  | { ok: false; nextActionKind: string; message: string; metadata: Record<string, unknown> } {
  if (!isAbsolute(template.outputDirectory)) {
    return {
      ok: false,
      nextActionKind: 'repair_output_directory',
      message: `User loop requires an absolute output directory before it can run: ${template.outputDirectory}`,
      metadata: {
        reason: 'relative_output_directory',
        outputDirectory: template.outputDirectory,
      },
    };
  }
  if (!isSafeLoopOutputFileName(template.outputFileName)) {
    return {
      ok: false,
      nextActionKind: 'repair_output_file_name',
      message: `User loop output filename must be a safe file name: ${template.outputFileName}`,
      metadata: {
        reason: 'unsafe_output_file_name',
        outputFileName: template.outputFileName,
      },
    };
  }
  const outputDirectory = resolve(template.outputDirectory);
  const outputPath = resolve(outputDirectory, template.outputFileName);
  if (dirname(outputPath) !== outputDirectory) {
    return {
      ok: false,
      nextActionKind: 'repair_output_file_name',
      message: `User loop output filename must stay inside the output directory: ${template.outputFileName}`,
      metadata: {
        reason: 'output_path_escape',
        outputDirectory: template.outputDirectory,
        outputFileName: template.outputFileName,
      },
    };
  }
  return { ok: true, outputDirectory, outputPath };
}

export function verifyMarkdownFile(outputPath: string): { ok: true } | { ok: false; reason: string } {
  try {
    const stat = statSync(outputPath);
    if (!stat.isFile()) return { ok: false, reason: 'not_file' };
    if (stat.size <= 0) return { ok: false, reason: 'empty_file' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'missing_file' };
  }
}
