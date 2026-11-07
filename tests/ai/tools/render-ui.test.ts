import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { A2UI_MIME_TYPE, validateA2uiMessages, parseUiJson } from '../../../src/a2ui/index.js';
import { buildToolList, ToolRegistry } from '../../../src/ai/tools/index.js';

const DASHBOARD_TOOL_NAME = ['render', 'ui'].join('_');

describe('A2UI dashboard tool', () => {
  it('advertises business requests without expanding the tool permission or schema', () => {
    const tool = buildToolList().find(candidate => candidate.definition.name === DASHBOARD_TOOL_NAME)!;
    expect(tool.definition.description).toContain('把销售数据做成图表');
    expect(tool.definition.description).toMatch(/不.*(?:点名|说出).*工具名/);
    expect(tool.definition.description).toContain('不编造数据');
    expect(tool.definition.description).toContain('内置');
    expect(tool.permission).toBe('write');
    const table = (tool.definition.inputSchema.properties as Record<string, any>).sections.items.oneOf.find((section: any) => section.properties.kind.enum[0] === 'table');
    expect(table.additionalProperties).toBe(false);
    for (const key of ['filters', 'actions', 'export']) expect(table.properties).not.toHaveProperty(key);
  });

  const tempDirs: string[] = [];

  function createTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes a discriminated section schema with the exact supported DSL fields', () => {
    const tool = buildToolList().find((candidate) => candidate.definition.name === DASHBOARD_TOOL_NAME);
    const sections = (tool?.definition.inputSchema.properties as { sections?: unknown } | undefined)?.sections as { items?: unknown } | undefined;
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
    const tempDir = createTempDir('xiaok-dashboard-');
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

  it('writes default A2UI artifacts to the user artifact root instead of cwd', async () => {
    const tempDir = createTempDir('xiaok-dashboard-default-');
    const artifactRoot = createTempDir('xiaok-dashboard-user-artifacts-');
    const registry = new ToolRegistry(
      { autoMode: true },
      buildToolList(undefined, { cwd: tempDir, allowOutsideCwd: false, artifactRoot }),
    );

    const resultText = await registry.executeTool(DASHBOARD_TOOL_NAME, {
      title: 'Default artifact root',
      sections: [
        { kind: 'heading', text: 'Default Root', level: 2 },
      ],
      data: {},
    });

    const result = JSON.parse(resultText) as {
      output_path: string;
      artifactPath: string;
      artifacts: Array<{ filename: string; key: string }>;
    };

    expect(result.output_path.startsWith(artifactRoot)).toBe(true);
    expect(result.artifactPath).toBe(result.output_path);
    expect(result.artifacts[0]?.key).toBe(result.output_path);
    expect(existsSync(result.output_path)).toBe(true);
    expect(existsSync(join(tempDir, 'artifacts', result.artifacts[0]!.filename))).toBe(false);
  });

  it('rejects invalid DSL without writing an artifact', async () => {
    const tempDir = createTempDir('xiaok-dashboard-invalid-');
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
    const tempDir = createTempDir('xiaok-dashboard-alias-');
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
  it('writes a near-budget artifact using the exact bounded format accepted on readback', async () => {
    const tempDir = createTempDir('xiaok-dashboard-byte-boundary-');
    const outputPath = join(tempDir, 'boundary.a2ui.json');
    const registry = new ToolRegistry({ autoMode: true }, buildToolList(undefined, { cwd: tempDir, allowOutsideCwd: false }));
    try {
      const result = JSON.parse(await registry.executeTool(DASHBOARD_TOOL_NAME, {
        title: 'Byte boundary', output_path: outputPath,
        sections: Array.from({ length: 20 }, () => ({ kind: 'text', content: '\u0000'.repeat(8306) })),
      }));
      const persisted = readFileSync(outputPath, 'utf8');
      expect(Buffer.byteLength(persisted)).toBeLessThanOrEqual(1_000_000);
      expect(result.artifacts[0].size).toBe(Buffer.byteLength(persisted));
      expect(validateA2uiMessages(parseUiJson(persisted))).toEqual({ ok: true });
    } finally { registry.dispose(); }
  });

});
