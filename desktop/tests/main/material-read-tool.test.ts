import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { MATERIAL_EXTRACTOR_VERSION } from '../../../src/runtime/materials/text-extractor.js';
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

  // D7：提取器改了算法（pptx 段落合并、xlsx 稀疏列补位）之后，已经读过一次的材料
  // 必须重新提取。否则修复对老材料永远不生效。
  it('discards a cache written by an older extractor version and re-extracts', async () => {
    const sourcePath = join(sourceDir, '季度复盘.pptx');
    writeFileSync(sourcePath, createMinimalPptx(['第一页标题']));
    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    // 模拟旧版本提取器留下的缓存：内容是旧算法的产物，版本号比当前低。
    const stalePath = join(dirname(record.workspacePath), `${record.materialId}.txt`);
    writeFileSync(stalePath, '旧版提取器的碎片结果', 'utf8');
    await registry.updateMaterialExtraction(record.materialId, {
      extractedTextPath: stalePath,
      parseStatus: 'parsed',
      extractorVersion: MATERIAL_EXTRACTOR_VERSION - 1,
    });

    const stale = registry.get(record.materialId)!;
    const result = await executeReadMaterialForDesktop(
      { materialId: record.materialId },
      { taskId: 'task_1', materials: [stale], materialRegistry: registry, maxChars: 5000 },
    );
    const payload = JSON.parse(result.result);

    expect(result.ok).toBe(true);
    expect(payload.cached).not.toBe(true);
    expect(payload.content).not.toContain('旧版提取器的碎片结果');
    expect(payload.content).toContain('第一页标题');
    expect(registry.get(record.materialId)?.extractorVersion).toBe(MATERIAL_EXTRACTOR_VERSION);
  });

  // 现有用户的记录里根本没有 extractorVersion 字段，这是真实的迁移场景。
  it('treats a cache with no recorded extractor version as stale', async () => {
    const sourcePath = join(sourceDir, '历史材料.pptx');
    writeFileSync(sourcePath, createMinimalPptx(['第一页标题']));
    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    const legacyPath = join(dirname(record.workspacePath), `${record.materialId}.txt`);
    writeFileSync(legacyPath, '版本化之前留下的缓存', 'utf8');
    const legacy = { ...registry.get(record.materialId)!, extractedTextPath: legacyPath };

    const result = await executeReadMaterialForDesktop(
      { materialId: record.materialId },
      { taskId: 'task_1', materials: [legacy], materialRegistry: registry, maxChars: 5000 },
    );
    const payload = JSON.parse(result.result);

    expect(payload.cached).not.toBe(true);
    expect(payload.content).not.toContain('版本化之前留下的缓存');
    expect(payload.content).toContain('第一页标题');
    expect(registry.get(record.materialId)?.extractorVersion).toBe(MATERIAL_EXTRACTOR_VERSION);
  });

  it('still reuses a cache stamped with the current extractor version', async () => {
    const sourcePath = join(sourceDir, '季度复盘.pptx');
    writeFileSync(sourcePath, createMinimalPptx(['第一页标题']));
    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    const currentPath = join(dirname(record.workspacePath), `${record.materialId}.txt`);
    writeFileSync(currentPath, '当前版本缓存内容', 'utf8');
    await registry.updateMaterialExtraction(record.materialId, {
      extractedTextPath: currentPath,
      parseStatus: 'parsed',
      extractorVersion: MATERIAL_EXTRACTOR_VERSION,
      sourceFingerprint: record.sha256,
    });

    const fresh = registry.get(record.materialId)!;
    const result = await executeReadMaterialForDesktop(
      { materialId: record.materialId },
      { taskId: 'task_1', materials: [fresh], materialRegistry: registry, maxChars: 5000 },
    );
    const payload = JSON.parse(result.result);

    expect(payload.cached).toBe(true);
    expect(payload.content).toContain('当前版本缓存内容');
  });

  it('keeps a canonical cache so an early small read does not poison a later large read', async () => {
    const sourcePath = join(sourceDir, 'legacy.doc');
    writeFileSync(sourcePath, 'legacy office bytes');
    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });
    const canonical = `# Full document\n${'完整正文'.repeat(20_000)}`;
    let parseCalls = 0;
    const officeToMarkdown = async () => {
      parseCalls += 1;
      return {
        ok: true as const,
        markdown: canonical,
        format: 'doc',
        engine: 'anydoc' as const,
        engineVersion: '0.1.8',
        chars: canonical.length,
        truncated: false,
      };
    };

    const first = await executeReadMaterialForDesktop(
      { materialId: record.materialId, maxChars: 1000 },
      { taskId: 'task_1', materials: [record], materialRegistry: registry, officeToMarkdown },
    );
    expect(JSON.parse(first.result).content.length).toBeLessThan(canonical.length);

    const updated = registry.get(record.materialId)!;
    const second = await executeReadMaterialForDesktop(
      { materialId: record.materialId, maxChars: 100_000 },
      { taskId: 'task_1', materials: [updated], materialRegistry: registry, officeToMarkdown },
    );
    const secondPayload = JSON.parse(second.result);
    expect(secondPayload.cached).toBe(true);
    expect(secondPayload.content.length).toBeGreaterThan(1000);
    expect(secondPayload.content).toContain('完整正文');
    expect(parseCalls).toBe(1);
    expect(updated.extractionEngine).toBe('anydoc');
    expect(updated.extractionEngineVersion).toBe('0.1.8');
    expect(updated.sourceFingerprint).toBe(record.sha256);
  });

  // D5：Desktop 注入 pdfjs 后 read_material 能读 PDF。
  // 未注入的宿主仍走 unsupported —— 由下方既有测试守住，此处不重复。
  it('reads a PDF when the host injects a pdf extractor', async () => {
    const sourcePath = join(sourceDir, '扫描合同.pdf');
    writeFileSync(sourcePath, '%PDF-1.7\n占位内容');
    const record = await registry.importMaterial({
      taskId: 'task_1',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });

    const result = await executeReadMaterialForDesktop(
      { materialId: record.materialId },
      {
        taskId: 'task_1',
        materials: [record],
        materialRegistry: registry,
        maxChars: 5000,
        pdfToText: async () => '合同第一页\n\n合同第二页',
      },
    );
    const payload = JSON.parse(result.result);

    expect(result.ok).toBe(true);
    expect(payload.parseStatus).toBe('parsed');
    expect(payload.content).toContain('合同第一页');
    expect(payload.content).toContain('合同第二页');
    expect(registry.get(record.materialId)?.extractorVersion).toBe(MATERIAL_EXTRACTOR_VERSION);
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

function createMinimalPptx(slides: string[]): Buffer {
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    ...slides.map((text, index) => ({
      name: `ppt/slides/slide${index + 1}.xml`,
      content:
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        + '<p:cSld><p:spTree><p:sp><p:txBody>'
        + `<a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p>`
        + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    })),
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
