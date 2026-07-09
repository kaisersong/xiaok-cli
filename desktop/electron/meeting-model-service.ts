import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, type WriteStream } from 'node:fs';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type MeetingModelCheckReason = 'ready' | 'missing' | 'size_mismatch' | 'hash_mismatch';
export type MeetingModelDownloadStatus = 'downloaded' | 'not_downloaded' | 'incomplete';

export interface MeetingModelDefinition {
  id: string;
  fileName: string;
  url: string;
  expectedSizeBytes: number;
  expectedSha256: string;
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

const MEETING_MODEL_DOWNLOAD_MAX_ATTEMPTS = 20;

export interface MeetingModelServiceOptions {
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
  models?: readonly MeetingModelDefinition[];
  downloadFile?: MeetingModelDownloadFile;
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

  function findModel(modelId: string): MeetingModelDefinition {
    const model = models.find(item => item.id === modelId);
    if (!model) throw new Error(`unknown_meeting_model:${modelId}`);
    return model;
  }

  function getModelInfo(model: MeetingModelDefinition): MeetingModelInfo {
    const modelPath = join(cacheDir, model.fileName);
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
      };
    }

    const localSizeBytes = statSync(modelPath).size;
    const downloaded = checkMeetingModelFile({
      path: modelPath,
      expectedSizeBytes: model.expectedSizeBytes,
      expectedSha256: model.expectedSha256,
    }).ready;
    return {
      id: model.id,
      fileName: model.fileName,
      sizeBytes: model.expectedSizeBytes,
      sizeLabel: formatMeetingModelSize(model.expectedSizeBytes),
      cacheDir,
      path: modelPath,
      downloaded,
      status: downloaded ? 'downloaded' : 'incomplete',
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
      mkdirSync(cacheDir, { recursive: true });
      const modelPath = join(cacheDir, model.fileName);
      await downloadFile(model.url, modelPath, {
        expectedSizeBytes: model.expectedSizeBytes,
        expectedSha256: model.expectedSha256,
      });
      let check = this.checkModelFile({
        path: modelPath,
        expectedSizeBytes: model.expectedSizeBytes,
        expectedSha256: model.expectedSha256,
      });
      if (!check.ready && check.reason === 'hash_mismatch') {
        rmSync(modelPath, { force: true });
        await downloadFile(model.url, modelPath, {
          expectedSizeBytes: model.expectedSizeBytes,
          expectedSha256: model.expectedSha256,
        });
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
      rmSync(join(cacheDir, model.fileName), { force: true });
      return { ok: true, model: getModelInfo(model) };
    },
  };
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
