import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadReportScorer(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/xiaok-product/scorers/report-scorer.mjs',
  )).href);
}

async function loadSlideScorer(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/xiaok-product/scorers/slide-scorer.mjs',
  )).href);
}

function reportTask(structure: Record<string, unknown> = {}): any {
  return {
    taskId: 'prod:report:t',
    category: 'report',
    expectations: {
      mustExist: true,
      artifactMatch: { kindAnyOf: ['text', 'html'], extensionAnyOf: ['.md', '.html'] },
      structure: {
        minSections: 3,
        requiredSectionKeywords: ['现状', '结论'],
        minChars: 50,
        ...structure,
      },
    },
  };
}

function signalsWith(artifacts: any[]): any {
  return { status: 'completed', artifacts, toolInvocations: [] };
}

const GOOD_MD = [
  '# 背景',
  '内容内容内容内容内容内容内容内容内容内容内容',
  '## 现状',
  '内容内容内容内容内容内容内容内容内容内容内容',
  '## 结论',
  '内容内容内容内容内容内容内容内容内容内容内容',
].join('\n');

describe('xiaok-product report scorer', () => {
  it('passes a structurally qualifying markdown report', async () => {
    const { scoreReport } = await loadReportScorer();
    const outcome = scoreReport({
      task: reportTask(),
      signals: signalsWith([{ artifactId: 'a1', kind: 'text', filePath: '/x/report.md' }]),
      fileExists: () => true,
      readTextFile: () => GOOD_MD,
    });
    expect(outcome.passed).toBe(true);
    expect(outcome.artifactPath).toBe('/x/report.md');
  });

  it('passes exactly at thresholds (boundary)', async () => {
    const { scoreReport } = await loadReportScorer();
    const content = '# A\n## 现状\n### 结论\n' + 'x'.repeat(50 - 14);
    const outcome = scoreReport({
      task: reportTask({ minSections: 3, minChars: content.length }),
      signals: signalsWith([{ artifactId: 'a1', kind: 'text', filePath: '/x/r.md' }]),
      fileExists: () => true,
      readTextFile: () => content,
    });
    expect(outcome.passed).toBe(true);
  });

  it('fails when a required section keyword is missing', async () => {
    const { scoreReport } = await loadReportScorer();
    const outcome = scoreReport({
      task: reportTask(),
      signals: signalsWith([{ artifactId: 'a1', kind: 'text', filePath: '/x/r.md' }]),
      fileExists: () => true,
      readTextFile: () => GOOD_MD.replace(/结论/g, '总结'),
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.reasons.join(' ')).toMatch(/keyword/i);
  });

  it('fails with artifact-missing when neither kind nor extension matches', async () => {
    const { scoreReport } = await loadReportScorer();
    const outcome = scoreReport({
      task: reportTask(),
      signals: signalsWith([{ artifactId: 'a1', kind: 'image', filePath: '/x/pic.png' }]),
      fileExists: () => true,
      readTextFile: () => GOOD_MD,
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.reasons.join(' ')).toMatch(/artifact-missing/);
  });

  it('fails when the artifact file does not exist on disk', async () => {
    const { scoreReport } = await loadReportScorer();
    const outcome = scoreReport({
      task: reportTask(),
      signals: signalsWith([{ artifactId: 'a1', kind: 'text', filePath: '/x/r.md' }]),
      fileExists: () => false,
      readTextFile: () => GOOD_MD,
    });
    expect(outcome.passed).toBe(false);
  });
});

describe('xiaok-product slide scorer', () => {
  const slideTask = (structure: Record<string, unknown>): any => ({
    taskId: 'prod:slide:t',
    category: 'slide',
    expectations: {
      mustExist: true,
      artifactMatch: { kindAnyOf: ['html', 'pptx', 'other'], extensionAnyOf: ['.html', '.pptx'] },
      structure,
    },
  });

  it('counts slide sections in text artifacts against minSlides', async () => {
    const { scoreSlide } = await loadSlideScorer();
    const html = '<section>1</section><section>2</section><section>3</section>';
    const passed = scoreSlide({
      task: slideTask({ minSlides: 3 }),
      signals: signalsWith([{ artifactId: 's1', kind: 'html', filePath: '/x/deck.html' }]),
      fileExists: () => true,
      readTextFile: () => html,
      fileSizeBytes: () => html.length,
    });
    expect(passed.passed).toBe(true);
    const failed = scoreSlide({
      task: slideTask({ minSlides: 4 }),
      signals: signalsWith([{ artifactId: 's1', kind: 'html', filePath: '/x/deck.html' }]),
      fileExists: () => true,
      readTextFile: () => html,
      fileSizeBytes: () => html.length,
    });
    expect(failed.passed).toBe(false);
  });

  it('scores binary pptx artifacts by existence and minimum size', async () => {
    const { scoreSlide } = await loadSlideScorer();
    const outcome = scoreSlide({
      task: slideTask({ minBytes: 1024 }),
      signals: signalsWith([{ artifactId: 's1', kind: 'pptx', filePath: '/x/deck.pptx' }]),
      fileExists: () => true,
      readTextFile: () => { throw new Error('binary'); },
      fileSizeBytes: () => 4096,
    });
    expect(outcome.passed).toBe(true);
    const tooSmall = scoreSlide({
      task: slideTask({ minBytes: 1024 }),
      signals: signalsWith([{ artifactId: 's1', kind: 'pptx', filePath: '/x/deck.pptx' }]),
      fileExists: () => true,
      readTextFile: () => { throw new Error('binary'); },
      fileSizeBytes: () => 10,
    });
    expect(tooSmall.passed).toBe(false);
  });
});
