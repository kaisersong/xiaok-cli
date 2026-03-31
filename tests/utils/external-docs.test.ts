import { describe, expect, it } from 'vitest';
import {
  buildExternalDocsTarget,
  collectForbiddenDocsPaths,
} from '../../src/utils/external-docs.js';

describe('external docs policy', () => {
  it('builds the sibling mydocs target for a project repo', () => {
    expect(buildExternalDocsTarget('xiaok-cli')).toBe('../mydocs/xiaok-cli');
  });

  it('flags staged docs content paths but allows the docs symlink root', () => {
    expect(collectForbiddenDocsPaths([
      'docs',
      'docs/analysis/report.md',
      'src/commands/yzj.ts',
      'docs\\superpowers\\plans\\plan.md',
    ])).toEqual([
      'docs/analysis/report.md',
      'docs/superpowers/plans/plan.md',
    ]);
  });
});
