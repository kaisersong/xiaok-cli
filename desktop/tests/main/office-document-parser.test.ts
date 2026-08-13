import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildOfficeWorkerEnv,
  createOfficeDocumentParser,
} from '../../electron/office-document-parser.js';

describe('OfficeDocumentParser process isolation', () => {
  let rootDir: string;
  let workerPath: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-office-parser-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    workerPath = join(rootDir, 'fixture-worker.mjs');
    writeFileSync(workerPath, fixtureWorkerSource(), 'utf8');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('rejects unsupported formats without starting a worker', async () => {
    const parser = createOfficeDocumentParser({ workerPath });
    const result = await parser.parse({ absolutePath: join(rootDir, 'notes.rtf'), maxOutputChars: 1000 });
    expect(result).toMatchObject({ ok: false, code: 'unsupported_format', retryable: false });
  });

  it('returns a validated versioned response from the child process', async () => {
    const inputPath = createInput(rootDir, 'success.docx');
    const parser = createOfficeDocumentParser({ workerPath });
    const result = await parser.parse({ absolutePath: inputPath, maxOutputChars: 1000 });
    expect(result).toEqual({
      ok: true,
      markdown: '# parsed success.docx',
      format: 'docx',
      engine: 'anydoc',
      engineVersion: '0.1.8',
      chars: 21,
      truncated: false,
    });
  });

  it('fails closed on invalid JSON and non-zero worker exits', async () => {
    const parser = createOfficeDocumentParser({ workerPath });
    await expect(parser.parse({
      absolutePath: createInput(rootDir, 'invalid.docx'),
      maxOutputChars: 1000,
    })).resolves.toMatchObject({ ok: false, code: 'protocol_error' });
    await expect(parser.parse({
      absolutePath: createInput(rootDir, 'crash.docx'),
      maxOutputChars: 1000,
    })).resolves.toMatchObject({ ok: false, code: 'worker_crashed' });
  });

  it('kills a worker that exceeds timeout or stdout limits', async () => {
    const timeoutParser = createOfficeDocumentParser({ workerPath, timeoutMs: 40 });
    await expect(timeoutParser.parse({
      absolutePath: createInput(rootDir, 'hang.docx'),
      maxOutputChars: 1000,
    })).resolves.toMatchObject({ ok: false, code: 'timeout' });

    const cappedParser = createOfficeDocumentParser({ workerPath, maxStdoutBytes: 128 });
    await expect(cappedParser.parse({
      absolutePath: createInput(rootDir, 'large.docx'),
      maxOutputChars: 1000,
    })).resolves.toMatchObject({ ok: false, code: 'resource_limit' });
  });

  it('kills an active worker when the caller aborts', async () => {
    const controller = new AbortController();
    const parser = createOfficeDocumentParser({ workerPath, timeoutMs: 2000 });
    const pending = parser.parse({
      absolutePath: createInput(rootDir, 'hang.docx'),
      maxOutputChars: 1000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' });
  });

  it('uses a FIFO queue to enforce the configured concurrency limit', async () => {
    const tracePath = join(rootDir, 'queue.trace');
    const parser = createOfficeDocumentParser({
      workerPath,
      maxConcurrency: 1,
    });
    await Promise.all([
      parser.parse({ absolutePath: createInput(rootDir, 'queue-a.docx'), maxOutputChars: 1000 }),
      parser.parse({ absolutePath: createInput(rootDir, 'queue-b.docx'), maxOutputChars: 1000 }),
    ]);
    await expect((await import('node:fs/promises')).readFile(tracePath, 'utf8')).resolves.toBe(
      'start:queue-a.docx\nend:queue-a.docx\nstart:queue-b.docx\nend:queue-b.docx\n',
    );
  });

  it('removes an aborted request from the queue before it starts a worker', async () => {
    const controller = new AbortController();
    const parser = createOfficeDocumentParser({ workerPath, maxConcurrency: 1, timeoutMs: 80 });
    const active = parser.parse({ absolutePath: createInput(rootDir, 'hang.docx'), maxOutputChars: 1000 });
    const queued = parser.parse({
      absolutePath: createInput(rootDir, 'queue-b.docx'),
      maxOutputChars: 1000,
      signal: controller.signal,
    });
    const abortedAt = Date.now();
    controller.abort();
    await expect(queued).resolves.toMatchObject({ ok: false, code: 'aborted' });
    expect(Date.now() - abortedAt).toBeLessThan(40);
    await active;
    const tracePath = join(rootDir, 'queue.trace');
    await expect((await import('node:fs/promises')).readFile(tracePath, 'utf8')).rejects.toThrow();
  });

  it('emits bounded diagnostics without exposing the absolute path', async () => {
    const diagnostics: unknown[] = [];
    const inputPath = createInput(rootDir, 'success.docx');
    const parser = createOfficeDocumentParser({
      workerPath,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    });
    await parser.parse({ absolutePath: inputPath, maxOutputChars: 1000 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      format: 'docx',
      inputBytes: 7,
      outputChars: 21,
      success: true,
    });
    expect(diagnostics[0]).toEqual(expect.objectContaining({
      pathHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      queueMs: expect.any(Number),
      spawnMs: expect.any(Number),
      parseMs: expect.any(Number),
      totalMs: expect.any(Number),
    }));
    expect(JSON.stringify(diagnostics[0])).not.toContain(inputPath);
  });

  it('passes only the runtime environment allowlist to the child', () => {
    const env = buildOfficeWorkerEnv({
      PATH: '/bin',
      SystemRoot: 'C:\\Windows',
      TMPDIR: '/tmp',
      LANG: 'zh_CN.UTF-8',
      OPENAI_API_KEY: 'secret',
      HTTPS_PROXY: 'http://credential@example.com',
    });
    expect(env).toMatchObject({
      PATH: '/bin',
      SystemRoot: 'C:\\Windows',
      TMPDIR: '/tmp',
      LANG: 'zh_CN.UTF-8',
      ELECTRON_RUN_AS_NODE: '1',
    });
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('HTTPS_PROXY');
  });
});

function createInput(rootDir: string, name: string): string {
  const path = join(rootDir, name);
  writeFileSync(path, 'fixture');
  return path;
}

function fixtureWorkerSource(): string {
  return `
import { appendFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw);
const name = basename(request.absolutePath);
const ok = () => process.stdout.write(JSON.stringify({
  protocolVersion: 1,
  ok: true,
  markdown: '# parsed ' + name,
  format: name.slice(name.lastIndexOf('.') + 1),
  engine: 'anydoc',
  engineVersion: '0.1.8',
  chars: ('# parsed ' + name).length,
  truncated: false,
}));
if (name.startsWith('invalid')) process.stdout.write('not-json');
else if (name.startsWith('crash')) process.exit(7);
else if (name.startsWith('large')) process.stdout.write('x'.repeat(4096));
else if (name.startsWith('hang')) setTimeout(ok, 10_000);
else if (name.startsWith('queue')) {
  const tracePath = join(dirname(request.absolutePath), 'queue.trace');
  appendFileSync(tracePath, 'start:' + name + '\\n');
  setTimeout(() => {
    appendFileSync(tracePath, 'end:' + name + '\\n');
    ok();
  }, 40);
} else ok();
`;
}
