import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, findModel, isModelDownloaded, getManualDownloadHint } from '../../../src/ai/memory/model-registry.js';

describe('model-registry', () => {
  it('has at least one model registered', () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThanOrEqual(1);
  });

  it('each model has required fields', () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.dims).toBeGreaterThan(0);
      expect(m.size).toBeTruthy();
      expect(m.languages).toBeTruthy();
      expect(m.requiredFiles).toContain('model.onnx');
      expect(m.requiredFiles).toContain('tokenizer.json');
      expect(m.downloadFiles.some((file) => file.filename === 'model.onnx' && file.url)).toBe(true);
      expect(m.downloadFiles.some((file) => file.filename === 'tokenizer.json' && file.url)).toBe(true);
    }
  });

  it('each model has mirror URLs', () => {
    for (const m of MODEL_REGISTRY) {
      for (const file of m.downloadFiles) {
        expect(file.mirror).toBeDefined();
        expect(file.mirror).toContain('hf-mirror.com');
      }
    }
  });

  it('findModel returns correct entry', () => {
    const m = findModel('all-MiniLM-L6-v2');
    expect(m).toBeDefined();
    expect(m!.dims).toBe(384);
  });

  it('findModel returns undefined for unknown model', () => {
    expect(findModel('nonexistent')).toBeUndefined();
  });

  it('isModelDownloaded returns false for nonexistent model', () => {
    expect(isModelDownloaded('__nonexistent_test__')).toBe(false);
  });

  it('getManualDownloadHint returns URLs and target dir', () => {
    const hint = getManualDownloadHint('all-MiniLM-L6-v2');
    expect(hint.urls.length).toBe(2);
    expect(hint.urls[0].file).toBe('model.onnx');
    expect(hint.targetDir).toContain('embedding');
  });
});
