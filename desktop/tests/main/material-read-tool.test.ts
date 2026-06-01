import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import {
  READ_MATERIAL_TOOL_DEFINITION,
  buildMaterialManifestForPrompt,
  executeReadMaterialForDesktop,
} from '../../electron/desktop-services.js';

describe('desktop read_material tool', () => {
  let rootDir: string;
  let sourceDir: string;
  let workspaceRoot: string;
  let registry: MaterialRegistry;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-read-material-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sourceDir = join(rootDir, 'source');
    workspaceRoot = join(rootDir, 'workspace');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    registry = new MaterialRegistry({ workspaceRoot, maxBytes: 1024 * 1024, now: () => 1_777_000_000 });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('advertises uploaded files as material ids without leaking local paths or full contents', async () => {
    const sourcePath = join(sourceDir, '董事会评审报告.docx');
    writeFileSync(sourcePath, createMinimalDocx(['这是一份董事会评审报告。']));
    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    const manifest = buildMaterialManifestForPrompt([record]);

    expect(READ_MATERIAL_TOOL_DEFINITION.name).toBe('read_material');
    expect(manifest).toContain('## 用户上传的文件');
    expect(manifest).toContain(`materialId: ${record.materialId}`);
    expect(manifest).toContain('read_material');
    expect(manifest).toContain('董事会评审报告.docx');
    expect(manifest).toContain(`大小: ${record.sizeBytes} bytes`);
    expect(manifest).not.toContain(record.workspacePath);
    expect(manifest).not.toContain('这是一份董事会评审报告');
  });

  it('reads and caches lightweight text extraction for the current task material', async () => {
    const sourcePath = join(sourceDir, '董事会评审报告.docx');
    writeFileSync(sourcePath, createMinimalDocx(['这是一份董事会评审报告。', '请进行对抗性评审。']));
    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    const result = await executeReadMaterialForDesktop(
      { materialId: record.materialId },
      { taskId: 'task_1', materials: [record], materialRegistry: registry, maxChars: 5000 },
    );
    const payload = JSON.parse(result.result);

    expect(result.ok).toBe(true);
    expect(payload).toMatchObject({
      ok: true,
      materialId: record.materialId,
      originalName: '董事会评审报告.docx',
      sizeBytes: record.sizeBytes,
      parseStatus: 'parsed',
    });
    expect(payload.content).toContain('董事会评审报告');
    expect(payload.content).toContain('对抗性评审');
    const updated = registry.get(record.materialId);
    expect(updated?.parseStatus).toBe('parsed');
    expect(updated?.extractedTextPath).toBeTruthy();
    expect(existsSync(updated!.extractedTextPath!)).toBe(true);
  });

  it('allows a staged material once it is attached to the current task', async () => {
    const sourcePath = join(sourceDir, 'brief.md');
    writeFileSync(sourcePath, '# 文件大小\n附件已经挂到当前任务。', 'utf8');
    const record = await registry.importMaterial({
      taskId: 'staging_task',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    const result = await executeReadMaterialForDesktop(
      { materialId: record.materialId },
      { taskId: 'actual_task', materials: [record], materialRegistry: registry, maxChars: 5000 },
    );
    const payload = JSON.parse(result.result);

    expect(result.ok).toBe(true);
    expect(payload).toMatchObject({
      ok: true,
      materialId: record.materialId,
      parseStatus: 'parsed',
    });
    expect(payload.content).toContain('附件已经挂到当前任务');
  });

  it('rejects non-current-task materials and reports unsupported heavy formats explicitly', async () => {
    const otherDocxPath = join(sourceDir, '其他任务.docx');
    const pdfPath = join(sourceDir, '扫描合同.pdf');
    writeFileSync(otherDocxPath, createMinimalDocx(['其他任务内容']));
    writeFileSync(pdfPath, '%PDF-1.7');
    const otherRecord = await registry.importMaterial({
      taskId: 'task_2',
      sourcePath: otherDocxPath,
      role: 'customer_material',
      roleSource: 'user',
    });
    const pdfRecord = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath: pdfPath,
      role: 'customer_material',
      roleSource: 'user',
    });

    const wrongTask = await executeReadMaterialForDesktop(
      { materialId: otherRecord.materialId },
      { taskId: 'task_1', materials: [pdfRecord], materialRegistry: registry },
    );
    expect(wrongTask.ok).toBe(false);
    expect(JSON.parse(wrongTask.result)).toMatchObject({ ok: false, error: 'material_not_attached' });

    const unsupported = await executeReadMaterialForDesktop(
      { materialId: pdfRecord.materialId },
      { taskId: 'task_1', materials: [pdfRecord], materialRegistry: registry },
    );
    expect(unsupported.ok).toBe(true);
    const unsupportedPayload = JSON.parse(unsupported.result);
    expect(unsupportedPayload).toMatchObject({
      ok: true,
      materialId: pdfRecord.materialId,
      originalName: '扫描合同.pdf',
      sizeBytes: pdfRecord.sizeBytes,
      contentAvailable: false,
      parseStatus: 'unsupported',
    });
    expect(unsupportedPayload.content).toBeUndefined();
    expect(registry.get(pdfRecord.materialId)?.parseStatus).toBe('unsupported');
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
