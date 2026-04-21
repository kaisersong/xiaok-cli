import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { platform } from 'node:process';

const execFileAsync = promisify(execFile);
const cliEntryPath = join(process.cwd(), '.test-dist', 'src', 'index.js');

function canSpawnChildProcesses(): boolean {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'pipe' });
  return !result.error && result.status === 0;
}

function ensureTestDistPackageJson(): void {
  const packageJsonPath = join(process.cwd(), '.test-dist', 'package.json');
  const doc = {
    version: '0.0.0-test',
    type: 'module',
  };
  if (existsSync(packageJsonPath)) {
    writeFileSync(packageJsonPath, JSON.stringify(doc, null, 2), 'utf8');
    return;
  }

  writeFileSync(packageJsonPath, JSON.stringify(doc, null, 2), 'utf8');
}

function writeConfig(configDir: string, config: Record<string, unknown>): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}

function writePlugin(
  cwd: string,
  name: string,
  manifest: Record<string, unknown>,
): void {
  const pluginDir = join(cwd, '.xiaok', 'plugins', name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function buildStreamingChunk(
  content: string,
  finishReason: string | null,
): string {
  return JSON.stringify({
    id: 'chatcmpl_fixture',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-smoke',
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function withFakeOpenAiServer(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void | Promise<void>,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    await handler(req, body, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind fake OpenAI server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

function cleanupDir(dir: string): void {
  const attempts = platform === 'win32' ? 8 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const isRetryable = typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: string }).code === 'EBUSY';
      if (!isRetryable || attempt === attempts - 1) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

describe('chat CLI smoke', () => {
  const tempDirs: string[] = [];
  const itIfCanSpawn = canSpawnChildProcesses() ? it : it.skip;

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      cleanupDir(dir);
    }
  });

  itIfCanSpawn('runs chat --auto --json end-to-end against a custom OpenAI-compatible provider', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const homeDir = join(rootDir, 'home');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    ensureTestDistPackageJson();

    const server = await withFakeOpenAiServer(async (_req, body, res) => {
      expect(JSON.parse(body)).toMatchObject({
        model: 'gpt-smoke',
      });
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
        'cache-control': 'no-cache',
      });
      res.write(`data: ${buildStreamingChunk('PONG', null)}\n\n`);
      res.write(`data: ${buildStreamingChunk('', 'stop')}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });

    try {
      writeConfig(configDir, {
        schemaVersion: 1,
        defaultModel: 'custom',
        models: {
          custom: {
            baseUrl: server.baseUrl,
            apiKey: 'test-key',
            model: 'gpt-smoke',
          },
        },
        defaultMode: 'interactive',
        contextBudget: 4000,
        channels: {},
      });

      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [cliEntryPath, 'chat', '--auto', '--json', '只回复 PONG'],
        {
          cwd: projectDir,
          env: {
            ...process.env,
            HOME: homeDir,
            XIAOK_CONFIG_DIR: configDir,
          },
        },
      );

      // Ignore Node deprecation warnings (e.g. punycode DEP0040 on Node 22+)
      const significantStderr = stderr.replace(/\(node:\d+\) \[DEP\d+\].*\n?/g, '').replace(/\(Use `node --trace-deprecation.*\n?/g, '').trim();
      expect(significantStderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({
        text: 'PONG',
      });
    } finally {
      await server.close();
    }
  }, 10_000);

  itIfCanSpawn('prints degraded capability health to stderr while still returning the chat result', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const homeDir = join(rootDir, 'home');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);
    mkdirSync(join(projectDir, '.xiaok'), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    ensureTestDistPackageJson();

    const server = await withFakeOpenAiServer(async (_req, _body, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
        'cache-control': 'no-cache',
      });
      res.write(`data: ${buildStreamingChunk('healthy reply', null)}\n\n`);
      res.write(`data: ${buildStreamingChunk('', 'stop')}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });

    try {
      writeConfig(configDir, {
        schemaVersion: 1,
        defaultModel: 'custom',
        models: {
          custom: {
            baseUrl: server.baseUrl,
            apiKey: 'test-key',
            model: 'gpt-smoke',
          },
        },
        defaultMode: 'interactive',
        contextBudget: 4000,
        channels: {},
      });
      writePlugin(projectDir, 'broken-platform', {
        name: 'broken-platform',
        version: '1.0.0',
        commands: [],
        mcpServers: [
          {
            name: 'broken-docs',
            type: 'stdio',
            command: process.execPath,
            args: ['-e', 'process.exit(1)'],
          },
        ],
      });

      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [cliEntryPath, 'chat', '--auto', '--json', '只回复 healthy reply'],
        {
          cwd: projectDir,
          env: {
            ...process.env,
            HOME: homeDir,
            XIAOK_CONFIG_DIR: configDir,
          },
        },
      );

      expect(JSON.parse(stdout)).toMatchObject({
        text: 'healthy reply',
      });
      expect(stderr).toContain('[platform] degraded capabilities detected');
      expect(stderr).toContain('mcp:broken-docs degraded');
    } finally {
      await server.close();
    }
  }, 10_000);
});
