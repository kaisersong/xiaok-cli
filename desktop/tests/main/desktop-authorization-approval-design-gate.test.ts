// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('authorization and approval joint design baseline', () => {
  it('both complete source documents match the same pending revision and external hash manifest', () => {
    const root = new URL('../../../docs/design/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('2026-09-07-desktop-authorization-approval-joint-manifest.json', root), 'utf8'));
    expect(manifest).toMatchObject({ revision: 'R5-joint-2', status: 'pending_joint_review', productionAdmitted: false });
    expect(manifest.documents).toHaveLength(2);
    for (const item of manifest.documents) {
      const source = readFileSync(new URL(item.file, root), 'utf8');
      expect(createHash('sha256').update(source).digest('hex')).toBe(item.sha256);
      expect(source.split('\n')[2]).toContain('R5（联合修订 2）');
      expect(source.split('\n')[2]).toContain('撤权 R5 + 审批 R5 待联合批准，production 尚未准入');
      expect(source).not.toContain('审批 R3');
    }
  });
});
