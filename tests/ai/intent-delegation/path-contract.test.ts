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
