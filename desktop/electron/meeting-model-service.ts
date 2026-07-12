import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, type WriteStream } from 'node:fs';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

export type MeetingModelCheckReason = 'ready' | 'missing' | 'size_mismatch' | 'hash_mismatch';
export type MeetingModelDownloadStatus = 'downloaded' | 'not_downloaded' | 'incomplete' | 'corrupt';
export type MeetingModelPackageState = 'missing' | 'downloading' | 'incomplete' | 'verified' | 'corrupt';
export type MeetingModelPackageType = 'single-file' | 'directory';
export type MeetingModelCapability = 'asr' | 'punctuation' | 'vad' | 'speaker';

export interface MeetingModelDefinition {
  id: string;
  capability?: MeetingModelCapability;
  fileName: string;
  url: string;
  mirrors?: readonly string[];
  expectedSizeBytes: number;
  expectedSha256: string;
  engineId?: string;
  packageId?: string;
  packageType?: MeetingModelPackageType;
  archiveFileName?: string;
  requiredFiles?: readonly string[];
  runtimeAutoDownloadAllowed?: false;
}

export interface MeetingModelInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
  sizeLabel: string;
  cacheDir: string;
  path: string;
  downloaded: boolean;
  status: MeetingModelDownloadStatus;
  capability: MeetingModelCapability;
  engineId: string;
  packageId: string;
  packageType: MeetingModelPackageType;
  packageState: MeetingModelPackageState;
  manifestTrusted: boolean;
  runtimeAutoDownloadAllowed: false;
  localSizeBytes?: number;
  localSizeLabel?: string;
}

export interface MeetingModelCheckInput {
  path: string;
  expectedSizeBytes: number;
  expectedSha256: string;
}

export type MeetingModelCheckResult =
  | { ready: true; reason: 'ready' }
  | { ready: false; reason: Exclude<MeetingModelCheckReason, 'ready'> };

export interface MeetingModelService {
  checkModelFile(input: MeetingModelCheckInput): MeetingModelCheckResult;
  listModels(): MeetingModelInfo[];
  downloadModel(modelId: string): Promise<{ ok: true; model: MeetingModelInfo }>;
  uninstallModel(modelId: string): { ok: true; model: MeetingModelInfo };
}

export interface MeetingModelDownloadOptions {
  expectedSizeBytes: number;
  expectedSha256: string;
}

export type MeetingModelDownloadFile = (url: string, destination: string, options: MeetingModelDownloadOptions) => Promise<void>;
export type MeetingModelExtractArchive = (archivePath: string, destinationDir: string, model: MeetingModelDefinition) => Promise<void>;

const MEETING_MODEL_DOWNLOAD_MAX_ATTEMPTS = 20;
const execFileAsync = promisify(execFileCallback);

export interface MeetingModelServiceOptions {
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
  models?: readonly MeetingModelDefinition[];
  downloadFile?: MeetingModelDownloadFile;
  extractArchive?: MeetingModelExtractArchive;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function checkMeetingModelFile(input: MeetingModelCheckInput): MeetingModelCheckResult {
  if (!existsSync(input.path)) {
    return { ready: false, reason: 'missing' };
  }
  const stat = statSync(input.path);
  if (stat.size !== input.expectedSizeBytes) {
    return { ready: false, reason: 'size_mismatch' };
  }
  if (sha256File(input.path) !== input.expectedSha256) {
    return { ready: false, reason: 'hash_mismatch' };
  }
  return { ready: true, reason: 'ready' };
}

export const MEETING_TRANSCRIBER_MODEL_REGISTRY: readonly MeetingModelDefinition[] = [
  {
    id: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
    capability: 'asr',
    engineId: 'sherpa-onnx-paraformer',
    packageId: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
    packageType: 'directory',
    fileName: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
    archiveFileName: 'sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2',
    expectedSizeBytes: 77_920_048,
    expectedSha256: 'da92b3db5218c5be53aad53e57d1b6e63e7fc98a0e054fbdd6dbe18e9c6b1450',
    requiredFiles: ['model.int8.onnx', 'tokens.txt'],
    runtimeAutoDownloadAllowed: false,
  },
  {
    id: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-int8',
    capability: 'punctuation',
    engineId: 'sherpa-onnx-punctuation',
    packageId: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-int8',
    packageType: 'directory',
    fileName: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
    archiveFileName: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2',
    expectedSizeBytes: 64_717_756,
    expectedSha256: 'c0d5aa5f8eeb686032345e180bedf39319dc2e0556781c6264bcadba8328a6e1',
    requiredFiles: ['model.int8.onnx'],
    runtimeAutoDownloadAllowed: false,
  },
  {
    id: 'base',
    fileName: 'base.pt',
    url: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
    expectedSizeBytes: 145_262_807,
    expectedSha256: 'ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e',
  },
  {
    id: 'small',
    fileName: 'small.pt',
    url: 'https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt',
    expectedSizeBytes: 483_617_219,
    expectedSha256: '9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794',
  },
  {
    id: 'medium',
    fileName: 'medium.pt',
    url: 'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
    expectedSizeBytes: 1_528_008_539,
    expectedSha256: '345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1',
  },
  {
    id: 'large',
    fileName: 'large-v3.pt',
    url: 'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt',
    expectedSizeBytes: 3_087_371_615,
    expectedSha256: 'e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb',
  },
  {
    id: 'turbo',
    fileName: 'large-v3-turbo.pt',
    url: 'https://openaipublic.azureedge.net/main/whisper/models/aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a/large-v3-turbo.pt',
    expectedSizeBytes: 1_617_941_637,
    expectedSha256: 'aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a',
  },
];

export function resolveMeetingWhisperCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.XIAOK_MEETING_WHISPER_CACHE?.trim();
  if (explicit) return explicit;
  const baseCacheDir = env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache');
  return join(baseCacheDir, 'whisper');
}

export function formatMeetingModelSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function createMeetingModelService(options: MeetingModelServiceOptions = {}): MeetingModelService {
  const env = options.env ?? process.env;
  const cacheDir = options.cacheDir ?? resolveMeetingWhisperCacheDir(env);
  const models = options.models ?? MEETING_TRANSCRIBER_MODEL_REGISTRY;
  const downloadFile = options.downloadFile ?? downloadMeetingModelFile;
  const extractArchive = options.extractArchive ?? extractMeetingModelArchive;

  function findModel(modelId: string): MeetingModelDefinition {
    const model = models.find(item => item.id === modelId);
    if (!model) throw new Error(`unknown_meeting_model:${modelId}`);
    return model;
  }

  function getModelInfo(model: MeetingModelDefinition): MeetingModelInfo {
    const modelPath = join(cacheDir, model.fileName);
    const baseInfo = buildModelPackageInfo(model);
    if ((model.packageType ?? 'single-file') === 'directory') {
      return getDirectoryModelInfo(model, modelPath, baseInfo);
    }
    if (!existsSync(modelPath)) {
      return {
        id: model.id,
        fileName: model.fileName,
        sizeBytes: model.expectedSizeBytes,
        sizeLabel: formatMeetingModelSize(model.expectedSizeBytes),
        cacheDir,
        path: modelPath,
        downloaded: false,
        status: 'not_downloaded',
        packageState: 'missing',
        ...baseInfo,
      };
    }

    const localSizeBytes = statSync(modelPath).size;
    const check = checkMeetingModelFile({
      path: modelPath,
      expectedSizeBytes: model.expectedSizeBytes,
      expectedSha256: model.expectedSha256,
    });
    const downloaded = check.ready;
    const status = downloaded ? 'downloaded' : check.reason === 'hash_mismatch' ? 'corrupt' : 'incomplete';
    const packageState: MeetingModelPackageState = downloaded
      ? 'verified'
      : status === 'corrupt'
        ? 'corrupt'
        : 'incomplete';
    return {
      id: model.id,
      fileName: model.fileName,
      sizeBytes: model.expectedSizeBytes,
      sizeLabel: formatMeetingModelSize(model.expectedSizeBytes),
      cacheDir,
      path: modelPath,
      downloaded,
      status,
      packageState,
      ...baseInfo,
      localSizeBytes,
      localSizeLabel: formatMeetingModelSize(localSizeBytes),
    };
  }

  return {
    checkModelFile: checkMeetingModelFile,
    listModels() {
      return models.map(getModelInfo);
    },
    async downloadModel(modelId) {
      const model = findModel(modelId);
      if ((model.packageType ?? 'single-file') === 'directory') {
        return downloadDirectoryModelPackage(model, cacheDir, downloadFile, extractArchive, getModelInfo);
      }
      mkdirSync(cacheDir, { recursive: true });
      const modelPath = join(cacheDir, model.fileName);
      await downloadModelFromMirrors(model, modelPath, downloadFile);
      let check = this.checkModelFile({
        path: modelPath,
        expectedSizeBytes: model.expectedSizeBytes,
        expectedSha256: model.expectedSha256,
      });
      if (!check.ready && check.reason === 'hash_mismatch') {
        rmSync(modelPath, { force: true });
        await downloadModelFromMirrors(model, modelPath, downloadFile);
        check = this.checkModelFile({
          path: modelPath,
          expectedSizeBytes: model.expectedSizeBytes,
          expectedSha256: model.expectedSha256,
        });
      }
      if (!check.ready) {
        throw new Error(check.reason);
      }
      return { ok: true, model: getModelInfo(model) };
    },
    uninstallModel(modelId) {
      const model = findModel(modelId);
      const isDirectoryPackage = (model.packageType ?? 'single-file') === 'directory';
      rmSync(join(cacheDir, model.fileName), { recursive: isDirectoryPackage, force: true });
      if (isDirectoryPackage) {
        rmSync(join(cacheDir, model.archiveFileName ?? `${model.fileName}.tar.bz2`), { force: true });
      }
      return { ok: true, model: getModelInfo(model) };
    },
  };
}

function getDirectoryModelInfo(
  model: MeetingModelDefinition,
  modelPath: string,
  baseInfo: Pick<
    MeetingModelInfo,
    'engineId' | 'packageId' | 'packageType' | 'manifestTrusted' | 'runtimeAutoDownloadAllowed' | 'capability'
  >,
): MeetingModelInfo {
  if (!existsSync(modelPath)) {
    return {
      id: model.id,
      fileName: model.fileName,
      sizeBytes: model.expectedSizeBytes,
      sizeLabel: formatMeetingModelSize(model.expectedSizeBytes),
      cacheDir: dirname(modelPath),
      path: modelPath,
      downloaded: false,
      status: 'not_downloaded',
      packageState: 'missing',
      ...baseInfo,
    };
  }

  const localSizeBytes = calculateLocalPackageSize(modelPath);
  const stat = statSync(modelPath);
  const requiredFiles = model.requiredFiles ?? [];
  const hasRequiredFiles = stat.isDirectory()
    && requiredFiles.every(requiredFile => existsSync(join(modelPath, requiredFile)));
  return {
    id: model.id,
    fileName: model.fileName,
    sizeBytes: model.expectedSizeBytes,
    sizeLabel: formatMeetingModelSize(model.expectedSizeBytes),
    cacheDir: dirname(modelPath),
    path: modelPath,
    downloaded: hasRequiredFiles,
    status: hasRequiredFiles ? 'downloaded' : 'incomplete',
    packageState: hasRequiredFiles ? 'verified' : 'incomplete',
    ...baseInfo,
    localSizeBytes,
    localSizeLabel: formatMeetingModelSize(localSizeBytes),
  };
}

function calculateLocalPackageSize(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) return total + calculateLocalPackageSize(childPath);
    if (entry.isFile()) return total + statSync(childPath).size;
    return total;
  }, 0);
}

async function downloadDirectoryModelPackage(
  model: MeetingModelDefinition,
  cacheDir: string,
  downloadFile: MeetingModelDownloadFile,
  extractArchive: MeetingModelExtractArchive,
  getModelInfo: (model: MeetingModelDefinition) => MeetingModelInfo,
): Promise<{ ok: true; model: MeetingModelInfo }> {
  mkdirSync(cacheDir, { recursive: true });
  const archivePath = join(cacheDir, model.archiveFileName ?? `${model.fileName}.tar.bz2`);
  const modelPath = join(cacheDir, model.fileName);
  await downloadModelFromMirrors(model, archivePath, downloadFile);
  let check = checkMeetingModelFile({
    path: archivePath,
    expectedSizeBytes: model.expectedSizeBytes,
    expectedSha256: model.expectedSha256,
  });
  if (!check.ready && check.reason === 'hash_mismatch') {
    rmSync(archivePath, { force: true });
    await downloadModelFromMirrors(model, archivePath, downloadFile);
    check = checkMeetingModelFile({
      path: archivePath,
      expectedSizeBytes: model.expectedSizeBytes,
      expectedSha256: model.expectedSha256,
    });
  }
  if (!check.ready) {
    throw new Error(check.reason);
  }

  rmSync(modelPath, { recursive: true, force: true });
  await extractArchive(archivePath, modelPath, model);
  rmSync(archivePath, { force: true });
  const info = getModelInfo(model);
  if (!info.downloaded) {
    throw new Error('model_package_incomplete');
  }
  return { ok: true, model: info };
}

async function extractMeetingModelArchive(
  archivePath: string,
  destinationDir: string,
  _model: MeetingModelDefinition,
): Promise<void> {
  mkdirSync(dirname(destinationDir), { recursive: true });
  await execFileAsync('tar', ['-xjf', archivePath, '-C', dirname(destinationDir)], {
    timeout: 10 * 60 * 1000,
  });
}

function buildModelPackageInfo(model: MeetingModelDefinition): Pick<
  MeetingModelInfo,
  'capability' | 'engineId' | 'packageId' | 'packageType' | 'manifestTrusted' | 'runtimeAutoDownloadAllowed'
> {
  return {
    capability: model.capability ?? 'asr',
    engineId: model.engineId ?? 'whisper',
    packageId: model.packageId ?? `whisper-${model.id}`,
    packageType: model.packageType ?? 'single-file',
    manifestTrusted: true,
    runtimeAutoDownloadAllowed: false,
  };
}

async function downloadModelFromMirrors(
  model: MeetingModelDefinition,
  modelPath: string,
  downloadFile: MeetingModelDownloadFile,
): Promise<void> {
  let lastError: unknown;
  for (const url of [model.url, ...(model.mirrors ?? [])]) {
    try {
      await downloadFile(url, modelPath, {
        expectedSizeBytes: model.expectedSizeBytes,
        expectedSha256: model.expectedSha256,
      });
      return;
    } catch (error) {
      lastError = error;
      rmSync(modelPath, { force: true });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('download_failed');
}

async function downloadMeetingModelFile(url: string, destination: string, options: MeetingModelDownloadOptions): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MEETING_MODEL_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await downloadMeetingModelFileOnce(url, destination, options);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableDownloadError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('download_failed:retry_exhausted');
}

function downloadMeetingModelFileOnce(url: string, destination: string, options: MeetingModelDownloadOptions): Promise<void> {
  const existingSize = existsSync(destination) ? statSync(destination).size : 0;
  if (existingSize >= options.expectedSizeBytes) {
    rmSync(destination, { force: true });
  }
  const startByte = existingSize > 0 && existingSize < options.expectedSizeBytes ? existingSize : 0;

  return new Promise((resolve, reject) => {
    const request = (href: string, rangeStart: number) => {
      const getter = selectHttpGetter(href);
      const headers = rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : undefined;
      let requestHandle: ClientRequest | null = null;
      requestHandle = getter(href, { headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('/') ? new URL(res.headers.location, href).href : res.headers.location;
          res.resume();
          request(next, rangeStart);
          return;
        }
        if (res.statusCode === 416 && rangeStart > 0) {
          res.resume();
          rmSync(destination, { force: true });
          request(href, 0);
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`download_failed:${res.statusCode ?? 'unknown'}`));
          return;
        }
        const append = res.statusCode === 206 && rangeStart > 0;
        const file = createWriteStream(destination, { flags: append ? 'a' : 'w' });
        let settled = false;
        const fail = (error: Error) => settleDownloadAttempt({
          error,
          file,
          reject,
          request: requestHandle,
          response: res,
          settled,
          setSettled: () => { settled = true; },
        });
        res.on('aborted', () => fail(new Error('aborted')));
        res.on('error', fail);
        file.on('error', fail);
        res.pipe(file);
        file.on('finish', () => {
          if (settled) return;
          settled = true;
          file.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            clampMeetingModelDownloadSize(destination, options.expectedSizeBytes);
            resolve();
          });
        });
      }).on('error', (error) => {
        reject(error);
      });
    };
    request(url, startByte);
  });
}

function settleDownloadAttempt(input: {
  error: Error;
  file: WriteStream;
  reject: (error: Error) => void;
  request: ClientRequest | null;
  response: IncomingMessage;
  settled: boolean;
  setSettled: () => void;
}): void {
  if (input.settled) return;
  input.setSettled();
  input.response.unpipe(input.file);
  input.response.destroy();
  input.request?.destroy();
  input.file.destroy();
  input.reject(input.error);
}

function clampMeetingModelDownloadSize(destination: string, expectedSizeBytes: number): void {
  if (!existsSync(destination)) return;
  if (statSync(destination).size > expectedSizeBytes) {
    truncateSync(destination, expectedSizeBytes);
  }
}

function selectHttpGetter(href: string): typeof httpGet {
  const protocol = new URL(href).protocol;
  if (protocol === 'http:') return httpGet;
  if (protocol === 'https:') return httpsGet;
  throw new Error(`unsupported_download_protocol:${protocol}`);
}

function isRetriableDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith('download_failed:') || error.message.startsWith('unsupported_download_protocol:')) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || code === 'EAI_AGAIN'
    || code === 'ENOTFOUND'
    || error.message === 'aborted'
    || error.message === 'socket hang up';
}
