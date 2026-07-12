import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MEETING_TRANSCRIBER_MODEL_REGISTRY,
  createMeetingModelService,
  sha256File,
} from '../../electron/meeting-model-service.js';

describe('MeetingModelService', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-meeting-model-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('marks a model ready only when size and hash match', () => {
    const modelPath = join(rootDir, 'base.bin');
    writeFileSync(modelPath, 'model-bytes');
    const hash = sha256File(modelPath);
    const service = createMeetingModelService();

    expect(service.checkModelFile({
      path: modelPath,
      expectedSizeBytes: Buffer.byteLength('model-bytes'),
      expectedSha256: hash,
    })).toEqual({ ready: true, reason: 'ready' });
  });

  it('rejects partial model files even when the path exists', () => {
    const modelPath = join(rootDir, 'base.bin');
    writeFileSync(modelPath, 'partial');
    const service = createMeetingModelService();

    expect(service.checkModelFile({
      path: modelPath,
      expectedSizeBytes: 1_024,
      expectedSha256: 'not-the-hash',
    })).toEqual({ ready: false, reason: 'size_mismatch' });
  });

  it('lists local speech model sizes and download completeness', () => {
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'base', fileName: 'base.pt', url: 'https://example.com/base.pt', expectedSizeBytes: 4, expectedSha256: 'df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119' },
        { id: 'small', fileName: 'small.pt', url: 'https://example.com/small.pt', expectedSizeBytes: 8, expectedSha256: 'small-hash' },
        { id: 'medium', fileName: 'medium.pt', url: 'https://example.com/medium.pt', expectedSizeBytes: 12, expectedSha256: 'medium-hash' },
      ],
    });
    writeFileSync(join(rootDir, 'base.pt'), Buffer.alloc(4));
    writeFileSync(join(rootDir, 'medium.pt'), Buffer.alloc(3));

    const models = service.listModels();
    expect(models[0]).toMatchObject({
        id: 'base',
        capability: 'asr',
        engineId: 'whisper',
        packageId: 'whisper-base',
        packageType: 'single-file',
        runtimeAutoDownloadAllowed: false,
        sizeBytes: 4,
        sizeLabel: '4 B',
        downloaded: true,
        status: 'downloaded',
        packageState: 'verified',
        localSizeBytes: 4,
        localSizeLabel: '4 B',
    });
    expect(models[1]).toMatchObject({
      id: 'small',
      engineId: 'whisper',
      packageId: 'whisper-small',
      sizeBytes: 8,
      sizeLabel: '8 B',
      downloaded: false,
      status: 'not_downloaded',
      packageState: 'missing',
    });
    expect(models[1].localSizeBytes).toBeUndefined();
    expect(models[2]).toMatchObject({
      id: 'medium',
      engineId: 'whisper',
      packageId: 'whisper-medium',
      sizeBytes: 12,
      sizeLabel: '12 B',
      downloaded: false,
      status: 'incomplete',
      packageState: 'incomplete',
      localSizeBytes: 3,
      localSizeLabel: '3 B',
    });
  });

  it('marks same-size models incomplete when the checksum does not match', () => {
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'base', fileName: 'base.pt', url: 'https://example.com/base.pt', expectedSizeBytes: 4, expectedSha256: 'not-the-real-hash' },
      ],
    });
    writeFileSync(join(rootDir, 'base.pt'), Buffer.alloc(4));

    expect(service.listModels()[0]).toMatchObject({
      id: 'base',
      downloaded: false,
      status: 'corrupt',
      packageState: 'corrupt',
      localSizeBytes: 4,
      localSizeLabel: '4 B',
    });
  });

  it('treats built-in manifests as trusted and disallows runtime model autodownload', () => {
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'base', fileName: 'base.pt', url: 'https://example.com/base.pt', expectedSizeBytes: 4, expectedSha256: 'base-hash' },
      ],
    });

    expect(service.listModels()[0]).toMatchObject({
      manifestTrusted: true,
      runtimeAutoDownloadAllowed: false,
    });
  });

  it('keeps built-in OpenAI Whisper model sizes visible for the settings UI', () => {
    expect(MEETING_TRANSCRIBER_MODEL_REGISTRY
      .filter(model => (model.engineId ?? 'whisper') === 'whisper')
      .map(model => ({
      id: model.id,
      fileName: model.fileName,
      expectedSizeBytes: model.expectedSizeBytes,
    }))).toEqual([
      { id: 'base', fileName: 'base.pt', expectedSizeBytes: 145_262_807 },
      { id: 'small', fileName: 'small.pt', expectedSizeBytes: 483_617_219 },
      { id: 'medium', fileName: 'medium.pt', expectedSizeBytes: 1_528_008_539 },
      { id: 'large', fileName: 'large-v3.pt', expectedSizeBytes: 3_087_371_615 },
      { id: 'turbo', fileName: 'large-v3-turbo.pt', expectedSizeBytes: 1_617_941_637 },
    ]);
  });

  it('includes the default sherpa-onnx Paraformer package for Chinese local ASR', () => {
    const model = MEETING_TRANSCRIBER_MODEL_REGISTRY.find(item => item.id === 'sherpa-onnx-paraformer-zh-small-2024-03-09');

    expect(model).toMatchObject({
      id: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      capability: 'asr',
      engineId: 'sherpa-onnx-paraformer',
      packageId: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      packageType: 'directory',
      fileName: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2',
      expectedSizeBytes: 77_920_048,
      expectedSha256: 'da92b3db5218c5be53aad53e57d1b6e63e7fc98a0e054fbdd6dbe18e9c6b1450',
      runtimeAutoDownloadAllowed: false,
      requiredFiles: ['model.int8.onnx', 'tokens.txt'],
    });
  });

  it('includes the default sherpa-onnx punctuation package as a separately managed punctuation model', () => {
    const model = MEETING_TRANSCRIBER_MODEL_REGISTRY.find(item => item.id === 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-int8');

    expect(model).toMatchObject({
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
      runtimeAutoDownloadAllowed: false,
      requiredFiles: ['model.int8.onnx'],
    });
  });

  it('checks directory model packages by required files instead of treating directory size as the model size', () => {
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        {
          id: 'paraformer-small',
          engineId: 'sherpa-onnx-paraformer',
          packageId: 'paraformer-small',
          packageType: 'directory',
          fileName: 'paraformer-small',
          url: 'https://example.com/paraformer-small.tar.bz2',
          expectedSizeBytes: 12,
          expectedSha256: 'archive-hash',
          requiredFiles: ['model.int8.onnx', 'tokens.txt'],
        },
      ],
    });

    expect(service.listModels()[0]).toMatchObject({
      id: 'paraformer-small',
      engineId: 'sherpa-onnx-paraformer',
      packageType: 'directory',
      downloaded: false,
      status: 'not_downloaded',
      packageState: 'missing',
    });

    const modelDir = join(rootDir, 'paraformer-small');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'model.int8.onnx'), Buffer.alloc(4));
    expect(service.listModels()[0]).toMatchObject({
      downloaded: false,
      status: 'incomplete',
      packageState: 'incomplete',
    });

    writeFileSync(join(modelDir, 'tokens.txt'), 'a\nb\n');
    expect(service.listModels()[0]).toMatchObject({
      downloaded: true,
      status: 'downloaded',
      packageState: 'verified',
      localSizeBytes: expect.any(Number),
    });
  });

  it('downloads and extracts directory model packages through the explicit model action', async () => {
    const archiveBytes = Buffer.from('trusted-paraformer-archive');
    const hash = sha256File(writeFixture(join(rootDir, 'hash-source.tar.bz2'), archiveBytes));
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        {
          id: 'paraformer-small',
          engineId: 'sherpa-onnx-paraformer',
          packageId: 'paraformer-small',
          packageType: 'directory',
          fileName: 'paraformer-small',
          archiveFileName: 'paraformer-small.tar.bz2',
          url: 'https://example.com/paraformer-small.tar.bz2',
          expectedSizeBytes: archiveBytes.length,
          expectedSha256: hash,
          requiredFiles: ['model.int8.onnx', 'tokens.txt'],
        },
      ],
      downloadFile: async (_url, destination) => {
        writeFileSync(destination, archiveBytes);
      },
      extractArchive: async (archivePath, destinationDir) => {
        expect(readFileSync(archivePath)).toEqual(archiveBytes);
        mkdirSync(destinationDir, { recursive: true });
        writeFileSync(join(destinationDir, 'model.int8.onnx'), Buffer.alloc(4));
        writeFileSync(join(destinationDir, 'tokens.txt'), 'a\nb\n');
      },
    });

    const result = await service.downloadModel('paraformer-small');

    expect(result).toEqual({
      ok: true,
      model: expect.objectContaining({
        id: 'paraformer-small',
        engineId: 'sherpa-onnx-paraformer',
        downloaded: true,
        status: 'downloaded',
      }),
    });
    expect(service.listModels()[0]).toMatchObject({ packageState: 'verified' });
    expect(existsSync(join(rootDir, 'paraformer-small.tar.bz2'))).toBe(false);
  });

  it('downloads a model through an explicit action and verifies size and hash before marking it ready', async () => {
    const bytes = Buffer.from('downloaded-model');
    const hash = sha256File(writeFixture(join(rootDir, 'hash-source.pt'), bytes));
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'small', fileName: 'small.pt', url: 'https://example.com/small.pt', expectedSizeBytes: bytes.length, expectedSha256: hash },
      ],
      downloadFile: async (_url, destination) => {
        writeFileSync(destination, bytes);
      },
    });

    const result = await service.downloadModel('small');

    expect(result).toEqual({ ok: true, model: expect.objectContaining({ id: 'small', downloaded: true, status: 'downloaded' }) });
    expect(service.listModels()[0]).toMatchObject({ id: 'small', downloaded: true, status: 'downloaded' });
  });

  it('fails over to the next trusted mirror and still verifies with the built-in checksum', async () => {
    const bytes = Buffer.from('mirror-model');
    const hash = sha256File(writeFixture(join(rootDir, 'hash-source.pt'), bytes));
    const urls: string[] = [];
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        {
          id: 'small',
          fileName: 'small.pt',
          url: 'https://mirror-a.example.com/small.pt',
          mirrors: ['https://mirror-b.example.com/small.pt'],
          expectedSizeBytes: bytes.length,
          expectedSha256: hash,
        },
      ],
      downloadFile: async (url, destination) => {
        urls.push(url);
        if (url.includes('mirror-a')) {
          throw new Error('download_failed');
        }
        writeFileSync(destination, bytes);
      },
    });

    const result = await service.downloadModel('small');

    expect(urls).toEqual([
      'https://mirror-a.example.com/small.pt',
      'https://mirror-b.example.com/small.pt',
    ]);
    expect(result).toEqual({ ok: true, model: expect.objectContaining({ id: 'small', packageState: 'verified' }) });
  });

  it('resumes an incomplete model download with an HTTP range request', async () => {
    const bytes = Buffer.from('partial-medium-model-bytes');
    const hash = sha256File(writeFixture(join(rootDir, 'hash-source.pt'), bytes));
    const existingBytes = bytes.subarray(0, 8);
    writeFileSync(join(rootDir, 'medium.pt'), existingBytes);
    const rangeServer = await startRangeServer(bytes);
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'medium', fileName: 'medium.pt', url: rangeServer.url, expectedSizeBytes: bytes.length, expectedSha256: hash },
      ],
    });

    try {
      const result = await service.downloadModel('medium');

      expect(result).toEqual({ ok: true, model: expect.objectContaining({ id: 'medium', downloaded: true, status: 'downloaded' }) });
      expect(rangeServer.ranges).toEqual([`bytes=${existingBytes.length}-`]);
      expect(readFileSync(join(rootDir, 'medium.pt'))).toEqual(bytes);
    } finally {
      await rangeServer.close();
    }
  });

  it('continues from the updated partial size after an interrupted range response', async () => {
    const bytes = Buffer.from('resumable-medium-model-after-abort');
    const hash = sha256File(writeFixture(join(rootDir, 'hash-source.pt'), bytes));
    const existingBytes = bytes.subarray(0, 8);
    writeFileSync(join(rootDir, 'medium.pt'), existingBytes);
    const rangeServer = await startInterruptedRangeServer(bytes, 5);
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'medium', fileName: 'medium.pt', url: rangeServer.url, expectedSizeBytes: bytes.length, expectedSha256: hash },
      ],
    });

    try {
      const result = await service.downloadModel('medium');

      expect(result).toEqual({ ok: true, model: expect.objectContaining({ id: 'medium', downloaded: true, status: 'downloaded' }) });
      expect(rangeServer.ranges).toEqual([`bytes=${existingBytes.length}-`, `bytes=${existingBytes.length + 5}-`]);
      expect(readFileSync(join(rootDir, 'medium.pt'))).toEqual(bytes);
    } finally {
      await rangeServer.close();
    }
  });

  it('redownloads from scratch when a completed resumed file fails checksum', async () => {
    const bytes = Buffer.from('trusted-medium-model');
    const corruptedBytes = Buffer.from('corrupt-medium-model');
    expect(corruptedBytes.length).toBe(bytes.length);
    const hash = sha256File(writeFixture(join(rootDir, 'hash-source.pt'), bytes));
    const calls: string[] = [];
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'medium', fileName: 'medium.pt', url: 'https://example.com/medium.pt', expectedSizeBytes: bytes.length, expectedSha256: hash },
      ],
      downloadFile: async (_url, destination) => {
        calls.push(destination);
        writeFileSync(destination, calls.length === 1 ? corruptedBytes : bytes);
      },
    });

    const result = await service.downloadModel('medium');

    expect(calls).toHaveLength(2);
    expect(result).toEqual({ ok: true, model: expect.objectContaining({ id: 'medium', downloaded: true, status: 'downloaded' }) });
    expect(readFileSync(join(rootDir, 'medium.pt'))).toEqual(bytes);
  });

  it('truncates extra trailing bytes before verifying the model checksum', async () => {
    const bytes = Buffer.from('trusted-medium-model');
    const hash = sha256File(writeFixture(join(rootDir, 'hash-source.pt'), bytes));
    const rangeServer = await startRangeServer(Buffer.concat([bytes, Buffer.from('extra-tail')]));
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'medium', fileName: 'medium.pt', url: rangeServer.url, expectedSizeBytes: bytes.length, expectedSha256: hash },
      ],
    });

    try {
      const result = await service.downloadModel('medium');

      expect(result).toEqual({ ok: true, model: expect.objectContaining({ id: 'medium', downloaded: true, status: 'downloaded' }) });
      expect(readFileSync(join(rootDir, 'medium.pt'))).toEqual(bytes);
    } finally {
      await rangeServer.close();
    }
  });

  it('refuses partial downloads and leaves the model incomplete', async () => {
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'medium', fileName: 'medium.pt', url: 'https://example.com/medium.pt', expectedSizeBytes: 10, expectedSha256: 'expected-hash' },
      ],
      downloadFile: async (_url, destination) => {
        writeFileSync(destination, Buffer.alloc(3));
      },
    });

    await expect(service.downloadModel('medium')).rejects.toThrow('size_mismatch');
    expect(service.listModels()[0]).toMatchObject({
      id: 'medium',
      downloaded: false,
      status: 'incomplete',
      localSizeBytes: 3,
    });
  });

  it('uninstalls downloaded or incomplete model files explicitly', () => {
    const modelPath = join(rootDir, 'base.pt');
    writeFileSync(modelPath, Buffer.alloc(4));
    const service = createMeetingModelService({
      cacheDir: rootDir,
      models: [
        { id: 'base', fileName: 'base.pt', url: 'https://example.com/base.pt', expectedSizeBytes: 4, expectedSha256: 'base-hash' },
      ],
    });

    const result = service.uninstallModel('base');

    expect(result).toEqual({ ok: true, model: expect.objectContaining({ id: 'base', status: 'not_downloaded' }) });
    expect(existsSync(modelPath)).toBe(false);
  });
});

function writeFixture(path: string, bytes: Buffer): string {
  writeFileSync(path, bytes);
  return path;
}

async function startRangeServer(bytes: Buffer): Promise<{ url: string; ranges: string[]; close: () => Promise<void> }> {
  const ranges: string[] = [];
  const server: Server = createServer((request, response) => {
    const range = request.headers.range ?? '';
    ranges.push(range);
    const match = /^bytes=(\d+)-$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      response.statusCode = 206;
      response.setHeader('Content-Range', `bytes ${start}-${bytes.length - 1}/${bytes.length}`);
      response.setHeader('Content-Length', String(bytes.length - start));
      response.end(bytes.subarray(start));
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Length', String(bytes.length));
    response.end(bytes);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('range_server_address_unavailable');
  }
  return {
    url: `http://127.0.0.1:${address.port}/medium.pt`,
    ranges,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

async function startInterruptedRangeServer(bytes: Buffer, interruptAfterBytes: number): Promise<{ url: string; ranges: string[]; close: () => Promise<void> }> {
  const ranges: string[] = [];
  let interrupted = false;
  const server: Server = createServer((request, response) => {
    const range = request.headers.range ?? '';
    ranges.push(range);
    const match = /^bytes=(\d+)-$/.exec(range);
    const start = match ? Number(match[1]) : 0;
    response.statusCode = match ? 206 : 200;
    response.setHeader('Content-Range', `bytes ${start}-${bytes.length - 1}/${bytes.length}`);
    response.setHeader('Content-Length', String(bytes.length - start));
    if (!interrupted) {
      interrupted = true;
      response.write(bytes.subarray(start, start + interruptAfterBytes));
      setTimeout(() => {
        response.destroy(new Error('fixture_connection_aborted'));
      }, 10);
      return;
    }
    response.end(bytes.subarray(start));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('range_server_address_unavailable');
  }
  return {
    url: `http://127.0.0.1:${address.port}/medium.pt`,
    ranges,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}
