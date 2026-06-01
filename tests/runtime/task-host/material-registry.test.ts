import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

describe('MaterialRegistry', () => {
  let rootDir: string;
  let sourceDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-task-host-material-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sourceDir = join(rootDir, 'source');
    workspaceRoot = join(rootDir, 'workspace');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('imports a supported file into the task workspace and exposes only safe view fields', async () => {
    const sourcePath = join(sourceDir, 'A客户需求.md');
    writeFileSync(sourcePath, '# A 客户需求\n需要制造业数字化方案。');
    const registry = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
      now: () => 1_777_000_000,
    });

    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    expect(record).toMatchObject({
      taskId: 'task_1',
      originalName: 'A客户需求.md',
      mimeType: 'text/markdown',
      role: 'customer_material',
      roleSource: 'user',
      parseStatus: 'pending',
      createdAt: 1_777_000_000,
    });
    expect(record.materialId).toMatch(/^mat_/);
    expect(record.sizeBytes).toBeGreaterThan(0);
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.workspacePath).toContain(join(workspaceRoot, 'task_1'));
    expect(existsSync(record.workspacePath)).toBe(true);
    expect(readFileSync(record.workspacePath, 'utf8')).toContain('制造业数字化方案');

    const view = registry.toView(record);
    expect(view).toEqual({
      materialId: record.materialId,
      originalName: 'A客户需求.md',
      role: 'customer_material',
      parseStatus: 'pending',
      parseSummary: undefined,
    });
    expect(view).not.toHaveProperty('workspacePath');
    expect(view).not.toHaveProperty('sha256');
    expect(view).not.toHaveProperty('sourcePath');
  });

  it('reloads imported material records from the workspace index', async () => {
    const sourcePath = join(sourceDir, 'A客户需求.md');
    const secondSourcePath = join(sourceDir, '产品资料.pdf');
    writeFileSync(sourcePath, '# A 客户需求');
    writeFileSync(secondSourcePath, 'pdf bytes');
    const registry = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
      now: () => 1_777_000_000,
    });

    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });
    const reloaded = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
      now: () => 1_777_000_001,
    });

    expect(reloaded.get(record.materialId)).toEqual(record);
    expect(reloaded.list('task_1')).toEqual([record]);

    const secondRecord = await reloaded.importMaterial({
      taskId: 'task_1',
      sourcePath: secondSourcePath,
      role: 'product_material',
      roleSource: 'user',
    });

    expect(secondRecord.materialId).not.toBe(record.materialId);
    expect(reloaded.list('task_1').map((item) => item.materialId)).toEqual([
      record.materialId,
      secondRecord.materialId,
    ]);
  });

  it('keeps imported docx materials pending until a task explicitly reads them', async () => {
    const sourcePath = join(sourceDir, '董事会评审报告.docx');
    writeFileSync(sourcePath, createMinimalDocx([
      '这是一份董事会评审报告。',
      '请进行对抗性评审。',
    ]));
    const registry = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
      now: () => 1_777_000_000,
    });

    const record = await registry.importMaterial({
      taskId: 'task_docx',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    expect(record).toMatchObject({
      originalName: '董事会评审报告.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      parseStatus: 'pending',
    });
    expect(record.extractedTextPath).toBeUndefined();

    const extractedTextPath = join(workspaceRoot, 'task_docx', 'materials', `${record.materialId}.txt`);
    writeFileSync(extractedTextPath, '这是一份董事会评审报告。');
    const updated = await registry.updateMaterialExtraction(record.materialId, {
      extractedTextPath,
      parseStatus: 'parsed',
      parseSummary: '已解析 Word 文档，提取 12 字符',
    });
    expect(updated).toMatchObject({
      materialId: record.materialId,
      parseStatus: 'parsed',
      parseSummary: '已解析 Word 文档，提取 12 字符',
      extractedTextPath,
    });

    const reloaded = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 1024 * 1024,
    });
    expect(reloaded.get(record.materialId)).toMatchObject({
      parseStatus: 'parsed',
      extractedTextPath,
    });
  });

  it('rejects unsupported, oversized, and unsafe source files', async () => {
    const registry = new MaterialRegistry({
      workspaceRoot,
      maxBytes: 4,
      now: () => 1,
    });
    const unsupported = join(sourceDir, 'script.sh');
    const oversized = join(sourceDir, 'large.md');
    const taskWorkspaceSource = join(workspaceRoot, 'task_1', 'already-imported.md');
    mkdirSync(join(workspaceRoot, 'task_1'), { recursive: true });
    writeFileSync(unsupported, 'echo nope');
    writeFileSync(oversized, '12345');
    writeFileSync(taskWorkspaceSource, 'inside workspace');

    await expect(registry.importMaterial({
      taskId: 'task_1',
      sourcePath: unsupported,
      role: 'unknown',
      roleSource: 'auto',
    })).rejects.toThrow(/unsupported/i);

    await expect(registry.importMaterial({
      taskId: 'task_1',
      sourcePath: oversized,
      role: 'unknown',
      roleSource: 'auto',
    })).rejects.toThrow(/oversized/i);

    await expect(registry.importMaterial({
      taskId: 'task_1',
      sourcePath: taskWorkspaceSource,
      role: 'unknown',
      roleSource: 'auto',
    })).rejects.toThrow(/unsafe/i);
  });
});

function createMinimalDocx(paragraphs: string[]): Buffer {
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    ...paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`),
    '</w:body></w:document>',
  ].join('');
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    { name: 'word/document.xml', content: documentXml },
  ]);
}

function createZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
