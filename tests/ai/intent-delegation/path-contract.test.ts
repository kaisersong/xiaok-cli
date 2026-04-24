import { describe, expect, it } from 'vitest';
import {
  buildSuggestedOutputPaths,
  extractProvidedSourcePaths,
  stripProvidedSourcePaths,
} from '../../../src/ai/intent-delegation/path-contract.js';

describe('intent path contract', () => {
  it('extracts explicit absolute source paths from user input', () => {
    const input = '把这篇文档生成 md，然后生成报告 /Users/song/Downloads/salesforce_ai_evolution.html';
    expect(extractProvidedSourcePaths(input)).toEqual([
      '/Users/song/Downloads/salesforce_ai_evolution.html',
    ]);
    expect(stripProvidedSourcePaths(input, extractProvidedSourcePaths(input))).toBe(
      '把这篇文档生成 md，然后生成报告',
    );
  });

  it('extracts multiple absolute paths even when the first one follows Chinese punctuation', () => {
    const input = '根据这几个文档，/Users/song/Downloads/AI原生工作中枢设计推演v2.docx /Users/song/Downloads/AI原生IM协同.md /Users/song/Downloads/AI原生企业的管理思想、管理范式与组织形态.pptx 整理一篇汇总的文档，然后生成幻灯片';
    expect(extractProvidedSourcePaths(input)).toEqual([
      '/Users/song/Downloads/AI原生工作中枢设计推演v2.docx',
      '/Users/song/Downloads/AI原生IM协同.md',
      '/Users/song/Downloads/AI原生企业的管理思想、管理范式与组织形态.pptx',
    ]);
  });

  it('derives safe sibling output paths without overwriting the source file', () => {
    const suggestions = buildSuggestedOutputPaths({
      sourcePaths: ['/Users/song/Downloads/salesforce_ai_evolution.html'],
      stages: [
        {
          stageId: 'intent:stage:1',
          order: 0,
          deliverable: 'md',
        },
        {
          stageId: 'intent:stage:2',
          order: 1,
          deliverable: '报告',
        },
      ],
    });

    expect(suggestions).toEqual([
      {
        stageId: 'intent:stage:1',
        deliverable: 'md',
        path: '/Users/song/Downloads/salesforce_ai_evolution.md',
      },
      {
        stageId: 'intent:stage:2',
        deliverable: '报告',
        path: '/Users/song/Downloads/salesforce_ai_evolution-report.html',
      },
    ]);
  });
});
