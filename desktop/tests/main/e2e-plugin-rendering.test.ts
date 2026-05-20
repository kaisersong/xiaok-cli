import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { createMcpRuntimeClient } from '../../../src/ai/mcp/runtime/client.js';
import { createStdioMcpTransport, startMcpServerProcess } from '../../../src/ai/mcp/runtime/server-process.js';
import { ensureReportRendererCssCompat } from '../../electron/deploy-bundled-plugins.js';
import { buildPythonServerEnv, ensureSlideRendererPythonReady } from '../../electron/python-runtime.js';

const REPORT_PLUGIN_SRC = join(
  __dirname, '..', '..', '..', '..',
  'kai-xiaok-plugins', 'plugins', 'kai-report-creator',
);
const REPORT_FIXTURE = join(
  REPORT_PLUGIN_SRC,
  'mcp-servers', 'report-renderer', 'tests', 'fixtures', 'valid-mixed.report.md',
);
const SLIDE_PLUGIN_SRC = join(
  __dirname, '..', '..', '..', '..',
  'kai-xiaok-plugins', 'plugins', 'kai-slide-creator',
);
const SLIDE_FIXTURE = join(
  SLIDE_PLUGIN_SRC,
  'mcp-servers', 'slide-renderer', 'tests', 'fixtures', 'valid-brief.json',
);
const MANAGED_PYTHON = process.platform === 'win32'
  ? join(homedir(), '.xiaok', 'runtime', 'python-env', 'Scripts', 'python.exe')
  : join(homedir(), '.xiaok', 'runtime', 'python-env', 'bin', 'python3');

function parseJsonText<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

async function withMcpClient<T>(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
  run: (client: ReturnType<typeof createMcpRuntimeClient>) => Promise<T>,
): Promise<T> {
  const proc = startMcpServerProcess(command, args, { cwd, env });
  const transport = createStdioMcpTransport(proc.child);
  const client = createMcpRuntimeClient(transport);
  try {
    await client.initialize();
    return await run(client);
  } finally {
    transport.dispose();
    proc.dispose();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      proc.child.once('exit', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }
}

describe('e2e: plugin rendering', () => {
  let testDir: string;

  beforeEach(() => {
    const baseDir = join(process.cwd(), '.tmp', 'plugin-rendering');
    mkdirSync(baseDir, { recursive: true });
    testDir = mkdtempSync(join(baseDir, 'run-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Windows child-process teardown can lag slightly; cleanup is best effort.
    }
  });

  it('report-renderer can render a real HTML report from deployed plugin files', async () => {
    if (!existsSync(REPORT_PLUGIN_SRC)) {
      throw new Error(`report plugin source not found: ${REPORT_PLUGIN_SRC}`);
    }

    const pluginDir = join(testDir, 'kai-report-creator');
    cpSync(REPORT_PLUGIN_SRC, pluginDir, { recursive: true });
    ensureReportRendererCssCompat(pluginDir);

    const outputPath = join(testDir, 'report-output.html');
    const irContent = readFileSync(REPORT_FIXTURE, 'utf8');
    const bundlePath = join(pluginDir, 'mcp-servers', 'report-renderer', 'dist', 'server.bundle.js');

    const result = await withMcpClient('node', [bundlePath], pluginDir, undefined, async (client) => {
      const raw = await client.callTool('render_report', {
        ir_content: irContent,
        output_path: outputPath,
      });
      return parseJsonText<{
        success: boolean;
        output_path: string;
        validation: { l0_passed: boolean; l1_passed: boolean; l2_passed: boolean };
      }>(raw);
    });

    expect(result.success).toBe(true);
    expect(result.output_path).toBe(outputPath);
    expect(result.validation).toMatchObject({ l0_passed: true, l1_passed: true, l2_passed: true });
    expect(existsSync(outputPath)).toBe(true);

    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('data-template="kai-report-creator"');
    expect(html).toContain('AI 技术趋势报告');
  });

  it('slide-renderer can render a real HTML deck through the managed python runtime', async () => {
    if (!existsSync(SLIDE_PLUGIN_SRC)) {
      throw new Error(`slide plugin source not found: ${SLIDE_PLUGIN_SRC}`);
    }
    if (!existsSync(MANAGED_PYTHON)) {
      throw new Error(`managed python runtime not found: ${MANAGED_PYTHON}`);
    }

    const runtimeReady = await ensureSlideRendererPythonReady({
      venvPython: MANAGED_PYTHON,
      wheelsDir: join(SLIDE_PLUGIN_SRC, 'bundled-wheels'),
      markerPath: join(homedir(), '.xiaok', 'runtime', 'python-env', '.deps-installed'),
    });
    expect(runtimeReady.ready).toBe(true);

    const pluginDir = join(testDir, 'kai-slide-creator');
    cpSync(SLIDE_PLUGIN_SRC, pluginDir, { recursive: true });

    const outputPath = join(testDir, 'slide-output.html');
    const briefJson = readFileSync(SLIDE_FIXTURE, 'utf8');
    const serverPath = join(pluginDir, 'mcp-servers', 'slide-renderer', 'server.py');

    const result = await withMcpClient(
      MANAGED_PYTHON,
      [serverPath],
      pluginDir,
      buildPythonServerEnv(),
      async (client) => {
      const raw = await client.callTool('render_slide', {
        brief_json: briefJson,
        output_path: outputPath,
      });
      return parseJsonText<{
        success: boolean;
        preset: string;
        stats: { html_bytes: number; page_count: number };
        errors: string[];
      }>(raw);
      },
    );

    expect(result.success).toBe(true);
    expect(result.preset).toBe('Data Story');
    expect(result.stats.html_bytes).toBeGreaterThan(1000);
    expect(result.stats.page_count).toBeGreaterThanOrEqual(5);
    expect(result.errors ?? []).toEqual([]);
    expect(existsSync(outputPath)).toBe(true);

    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('data-generator="kai-slide-creator"');
    expect(html).toContain('Data Story');
    expect(html).toContain('金蝶灵基');
  }, 20_000);
});
