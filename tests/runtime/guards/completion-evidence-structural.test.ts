import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateCompletionEvidence,
  type CompletionEvidenceRecord,
  type CompletionExpectation,
} from '../../../src/runtime/guards/completion-evidence.js';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'evidence-structural-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function fileExpectation(): CompletionExpectation {
  return {
    ownerKind: 'task',
    ownerId: 'task-1',
    expectedKinds: ['file_artifact'],
    source: 'task_spec',
    confidence: 'explicit',
  };
}

function validate(evidence: CompletionEvidenceRecord[]) {
  return validateCompletionEvidence({
    ownerKind: 'task',
    ownerId: 'task-1',
    targetStatus: 'completed',
    expectation: fileExpectation(),
    evidence,
  });
}

describe('completion-evidence structural checks (warn mode)', () => {
  it('returns ok:true with warning for corrupt PDF via localPaths', () => {
    const filePath = join(tempDir, 'bad.pdf');
    writeFileSync(filePath, 'not a pdf');
    const result = validate([{
      ownerKind: 'task',
      ownerId: 'task-1',
      kind: 'file_artifact',
      summary: 'Generated report',
      metadata: { localPaths: [filePath], workspaceRoot: tempDir },
    }]);
    expect(result.ok).toBe(true);
    expect(result.warning).toContain('pdf');
    expect(result.warning).toContain('%PDF-');
  });

  it('returns ok:true without warning for valid PDF via localPaths', () => {
    const filePath = join(tempDir, 'good.pdf');
    writeFileSync(filePath, '%PDF-1.4\n1 0 obj\n');
    const result = validate([{
      ownerKind: 'task',
      ownerId: 'task-1',
      kind: 'file_artifact',
      summary: 'Generated report',
      metadata: { localPaths: [filePath], workspaceRoot: tempDir },
    }]);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('returns ok:true with warning for corrupt PPTX via localPaths', () => {
    const filePath = join(tempDir, 'bad.pptx');
    writeFileSync(filePath, 'this is not a pptx');
    const result = validate([{
      ownerKind: 'task',
      ownerId: 'task-1',
      kind: 'file_artifact',
      summary: 'Generated slides',
      metadata: { localPaths: [filePath], workspaceRoot: tempDir },
    }]);
    expect(result.ok).toBe(true);
    expect(result.warning).toContain('pptx');
  });

  it('skips structural check for .docx (not in scope)', () => {
    const filePath = join(tempDir, 'doc.docx');
    writeFileSync(filePath, 'not a valid docx either');
    const result = validate([{
      ownerKind: 'task',
      ownerId: 'task-1',
      kind: 'file_artifact',
      summary: 'Generated doc',
      metadata: { localPaths: [filePath], workspaceRoot: tempDir },
    }]);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('skips structural check for .html (not in scope)', () => {
    const filePath = join(tempDir, 'report.html');
    writeFileSync(filePath, 'not valid html');
    const result = validate([{
      ownerKind: 'task',
      ownerId: 'task-1',
      kind: 'file_artifact',
      summary: 'Generated report',
      metadata: { localPaths: [filePath], workspaceRoot: tempDir },
    }]);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('skips structural check for unknown extension', () => {
    const filePath = join(tempDir, 'data.xyz');
    writeFileSync(filePath, 'random data');
    const result = validate([{
      ownerKind: 'task',
      ownerId: 'task-1',
      kind: 'file_artifact',
      summary: 'Generated data',
      metadata: { localPaths: [filePath], workspaceRoot: tempDir },
    }]);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  describe('C2 bypass prevention', () => {
    it('structural check fires for evidence with uri field (file:// URI)', () => {
      const filePath = join(tempDir, 'uri-bad.pdf');
      writeFileSync(filePath, 'not a pdf');
      const result = validate([{
        ownerKind: 'task',
        ownerId: 'task-1',
        kind: 'file_artifact',
        summary: 'Report via URI',
        uri: `file://${filePath}`,
      }]);
      expect(result.ok).toBe(true);
      expect(result.warning).toContain('pdf');
    });

    it('structural check fires for evidence with metadata.paths', () => {
      const filePath = join(tempDir, 'paths-bad.pptx');
      writeFileSync(filePath, 'not a pptx');
      const result = validate([{
        ownerKind: 'task',
        ownerId: 'task-1',
        kind: 'file_artifact',
        summary: 'Slides via paths',
        metadata: { paths: [filePath] },
      }]);
      expect(result.ok).toBe(true);
      expect(result.warning).toContain('pptx');
    });

    it('skips structural check for https:// URI (non-local)', () => {
      const result = validate([{
        ownerKind: 'task',
        ownerId: 'task-1',
        kind: 'file_artifact',
        summary: 'Remote report',
        uri: 'https://example.com/report.pdf',
      }]);
      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('passes valid PDF through uri path', () => {
      const filePath = join(tempDir, 'uri-good.pdf');
      writeFileSync(filePath, '%PDF-1.7\nvalid');
      const result = validate([{
        ownerKind: 'task',
        ownerId: 'task-1',
        kind: 'file_artifact',
        summary: 'Report via URI',
        uri: `file://${filePath}`,
      }]);
      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
    });
  });
});
