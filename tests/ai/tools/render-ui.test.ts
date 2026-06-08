import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { A2UI_MIME_TYPE, validateA2uiMessages } from '../../../src/a2ui/index.js';
import { buildToolList, ToolRegistry } from '../../../src/ai/tools/index.js';

const DASHBOARD_TOOL_NAME = ['render', 'ui'].join('_');

describe('A2UI dashboard tool', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it('exposes a discriminated section schema with the exact supported DSL fields', () => {
    const tool = buildToolList().find((candidate) => candidate.definition.name === DASHBOARD_TOOL_NAME);
    const sections = tool?.definition.inputSchema.properties?.sections as { items?: unknown } | undefined;
    const schemaText = JSON.stringify(sections?.items);

    expect(schemaText).toContain('"oneOf"');
    expect(schemaText).toContain('"kind"');
    expect(schemaText).toContain('"heading"');
    expect(schemaText).toContain('"text"');
    expect(schemaText).toContain('"metric"');
    expect(schemaText).toContain('"table"');
    expect(schemaText).toContain('"list"');
    expect(schemaText).toContain('"divider"');
    expect(schemaText).toContain('"content"');
  });

  it('is registered by default and writes an A2UI artifact file with a short ack', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'xiaok-dashboard-'));
    const outputPath = join(tempDir, 'artifacts', 'sales.a2ui.json');
    const registry = new ToolRegistry({ autoMode: true }, buildToolList(undefined, { cwd: tempDir, allowOutsideCwd: false }));

    const resultText = await registry.executeTool(DASHBOARD_TOOL_NAME, {
      title: 'Sales dashboard',
      output_path: outputPath,
      sections: [
        { kind: 'heading', text: 'Sales', level: 2 },
        { kind: 'metric', label: 'Revenue', value: '$42M' },
        { kind: 'table', columns: ['Region', 'Revenue'], rows: [['APAC', '$12M']] },
      ],
      data: { secret: 'do not serialize' },
    });

    const result = JSON.parse(resultText) as {
      ok: boolean;
      surfaceId: string;
      output_path: string;
      artifactPath: string;
      mimeType: string;
      artifacts: Array<{ filename: string; mime_type: string; key: string; display: string }>;
      componentCount: number;
    };

    expect(result).toMatchObject({
      ok: true,
      output_path: outputPath,
      artifactPath: outputPath,
      mimeType: A2UI_MIME_TYPE,
      componentCount: 4,
    });
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        filename: 'sales.a2ui.json',
        mime_type: A2UI_MIME_TYPE,
        key: outputPath,
        display: 'inline',
      }),
    ]);

    const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(validateA2uiMessages(payload)).toEqual({ ok: true });
    expect(JSON.stringify(payload)).not.toContain('do not serialize');
  });

  it('rejects invalid DSL without writing an artifact', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'xiaok-dashboard-invalid-'));
    const outputPath = join(tempDir, 'bad.a2ui.json');
    const registry = new ToolRegistry({ autoMode: true }, buildToolList(undefined, { cwd: tempDir, allowOutsideCwd: false }));

    const resultText = await registry.executeTool(DASHBOARD_TOOL_NAME, {
      title: 'Bad dashboard',
      output_path: outputPath,
      sections: [{ kind: 'table', columns: ['A'], rows: Array.from({ length: 201 }, () => ['x']) }],
      data: {},
    });

    expect(resultText).toMatch(/^Error: /);
    expect(() => readFileSync(outputPath, 'utf8')).toThrow();
  });

  it('normalizes common type and text aliases before writing the artifact', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'xiaok-dashboard-alias-'));
    const outputPath = join(tempDir, 'alias.a2ui.json');
    const registry = new ToolRegistry({ autoMode: true }, buildToolList(undefined, { cwd: tempDir, allowOutsideCwd: false }));

    const resultText = await registry.executeTool(DASHBOARD_TOOL_NAME, {
      title: 'Alias dashboard',
      output_path: outputPath,
      sections: [
        { type: 'text', text: 'Hello from a natural discriminator.' },
        { type: 'divider' },
      ],
      data: {},
    });

    expect(resultText).not.toMatch(/^Error: /);
    const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(validateA2uiMessages(payload)).toEqual({ ok: true });
    expect(JSON.stringify(payload)).toContain('Hello from a natural discriminator.');
  });
});
