import { existsSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import {
  segmentChineseAsync,
  segmentationRuntimeInfo,
  type SegmentationRuntimeInfo,
} from '../../src/ai/memory/segment.js';

/**
 * Packaged desktop Chinese segmentation smoke (#150 M6, CTO ruling 2026-11-03).
 *
 * Runs inside the packaged app process and goes through the product path the
 * memory store uses (segment.ts → off-thread worker → nodejieba). It fails the
 * whole packaged smoke when the output differs from the terminal-ui expectation,
 * when the dictionary did not load through the worker (fallback or no worker),
 * or when nodejieba / its dictionaries were not loaded from the packaged app's
 * app.asar / app.asar.unpacked (for example a development node_modules).
 */
export const PACKAGED_SEGMENTATION_SAMPLE = '南京市长江大桥';
/** Same expectation as the terminal-ui "Verify nodejieba binding loads" step. */
export const PACKAGED_SEGMENTATION_EXPECTED = '南京市 长江大桥';

export interface PackagedAppLocation {
  /** Electron process.resourcesPath of the packaged app. */
  resourcesPath: string;
  /** Electron app.isPackaged. */
  isPackaged: boolean;
  platform?: NodeJS.Platform;
}

export interface PackagedSegmentationResult {
  status: 'pass';
  sample: string;
  expected: string;
  output: string;
  /** Wall time of the first segmentChineseAsync call: worker start, dictionary load and cut. */
  elapsedMs: number;
  workerEntry: string;
  nativeBinding: string;
  dictionaryDir: string;
}

export interface PackagedSegmentationObservation {
  output: string;
  elapsedMs: number;
  info: SegmentationRuntimeInfo;
  app: PackagedAppLocation;
  fileExists?: (path: string) => boolean;
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

/** Strip the Windows namespace prefix segment.ts adds before native loads. */
function plainPath(filePath: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return filePath;
  if (filePath.startsWith('\\\\?\\UNC\\')) return `\\\\${filePath.slice(8)}`;
  if (filePath.startsWith('\\\\?\\')) return filePath.slice(4);
  return filePath;
}

/**
 * The packaged-app location a native file loaded from, or null when it is
 * outside <resourcesPath>/app.asar(.unpacked).
 */
function packagedLocation(filePath: string, app: PackagedAppLocation): 'app.asar' | 'app.asar.unpacked' | null {
  const platform = app.platform ?? process.platform;
  const api = pathApi(platform);
  const fold = (value: string) => (platform === 'win32' ? value.toLowerCase() : value);
  const target = fold(api.resolve(plainPath(filePath, platform)));
  for (const archive of ['app.asar.unpacked', 'app.asar'] as const) {
    const root = fold(api.resolve(app.resourcesPath, archive));
    const rel = api.relative(root, target);
    if (rel !== '' && !rel.startsWith('..') && !api.isAbsolute(rel)) return archive;
  }
  return null;
}

/** All reasons the observation fails the packaged smoke; empty when it passes. */
export function packagedSegmentationErrors(observation: PackagedSegmentationObservation): string[] {
  const { output, info, app } = observation;
  const expected = PACKAGED_SEGMENTATION_EXPECTED;
  const fileExists = observation.fileExists ?? existsSync;
  const errors: string[] = [];
  if (!app.isPackaged) errors.push('not running from a packaged app (app.isPackaged=false)');
  if (output !== expected) errors.push(`cut(${JSON.stringify(PACKAGED_SEGMENTATION_SAMPLE)})=${JSON.stringify(output)}, expected ${JSON.stringify(expected)}`);
  if (info.workerEntry === null) errors.push('segmentation worker did not start (dictionary unreadable or nodejieba not resolvable)');
  if (info.failureReason !== null) errors.push(`segmentation worker fell back: ${info.failureReason}`);
  else if (!info.workerReady) errors.push('segmentation worker did not finish loading the dictionary');
  if (info.synchronousLoad) errors.push('dictionary was loaded on the calling thread (synchronous fallback), not by the worker');
  if (info.workerEntry !== null) {
    const binding = join(dirname(plainPath(info.workerEntry, app.platform ?? process.platform)), 'build', 'Release', 'nodejieba.node');
    if (packagedLocation(info.workerEntry, app) === null) errors.push(`nodejieba entry is outside the packaged app: ${info.workerEntry}`);
    if (!fileExists(binding)) errors.push(`nodejieba native binding missing: ${binding}`);
  }
  for (const [name, filePath] of Object.entries(info.dictionaryPaths ?? {})) {
    if (packagedLocation(filePath, app) === null) errors.push(`dictionary ${name} is outside the packaged app: ${filePath}`);
  }
  return errors;
}

export interface PackagedSegmentationDeps {
  segment?: (text: string) => Promise<string>;
  info?: () => SegmentationRuntimeInfo;
  now?: () => number;
  log?: (line: string) => void;
  fileExists?: (path: string) => boolean;
}

/**
 * Run the segmentation step in the packaged app. Throws (failing the packaged
 * smoke) on any error from packagedSegmentationErrors; logs the load path and
 * elapsed time either way.
 */
export async function runPackagedSegmentationSmoke(
  app: PackagedAppLocation,
  deps: PackagedSegmentationDeps = {},
): Promise<PackagedSegmentationResult> {
  const segment = deps.segment ?? segmentChineseAsync;
  const readInfo = deps.info ?? segmentationRuntimeInfo;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => { console.log(line); });
  const startedAt = now();
  let output: string;
  try {
    output = await segment(PACKAGED_SEGMENTATION_SAMPLE);
  } catch (error) {
    throw new Error(`PACKAGED_SEGMENTATION_FAILED: segmentation threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const elapsedMs = now() - startedAt;
  const info = readInfo();
  const platform = app.platform ?? process.platform;
  const workerEntry = info.workerEntry ?? '';
  const nativeBinding = workerEntry ? join(dirname(plainPath(workerEntry, platform)), 'build', 'Release', 'nodejieba.node') : '';
  const firstDict = Object.values(info.dictionaryPaths ?? {})[0];
  const dictionaryDir = firstDict ? dirname(plainPath(firstDict, platform)) : '';
  log(`[packaged-segmentation-smoke] output=${JSON.stringify(output)} elapsedMs=${elapsedMs} workerEntry=${workerEntry || '(none)'} nativeBinding=${nativeBinding || '(none)'} dictionaryDir=${dictionaryDir || '(none)'} failureReason=${info.failureReason ?? 'none'}`);
  const errors = packagedSegmentationErrors({ output, elapsedMs, info, app, fileExists: deps.fileExists });
  if (errors.length > 0) throw new Error(`PACKAGED_SEGMENTATION_FAILED: ${errors.join('; ')}`);
  return {
    status: 'pass',
    sample: PACKAGED_SEGMENTATION_SAMPLE,
    expected: PACKAGED_SEGMENTATION_EXPECTED,
    output,
    elapsedMs,
    workerEntry,
    nativeBinding,
    dictionaryDir,
  };
}
