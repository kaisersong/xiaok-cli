import { describe, expect, it, vi } from 'vitest';
import {
  bumpSkillCatalogVersion,
  getSkillCatalogVersion,
  onSkillCatalogChanged,
} from '../../electron/skill-catalog-invalidation.js';

describe('skill catalog invalidation', () => {
  it('bumps the version monotonically', () => {
    const before = getSkillCatalogVersion();
    bumpSkillCatalogVersion();
    expect(getSkillCatalogVersion()).toBe(before + 1);
    bumpSkillCatalogVersion();
    expect(getSkillCatalogVersion()).toBe(before + 2);
  });

  it('notifies subscribers on bump and stops after unsubscribe', () => {
    const seen = vi.fn();
    const unsubscribe = onSkillCatalogChanged(seen);
    bumpSkillCatalogVersion();
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
    bumpSkillCatalogVersion();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keeps bumping when a listener throws', () => {
    const bad = onSkillCatalogChanged(() => { throw new Error('boom'); });
    const seen = vi.fn();
    const good = onSkillCatalogChanged(seen);
    const before = getSkillCatalogVersion();
    expect(() => bumpSkillCatalogVersion()).not.toThrow();
    expect(getSkillCatalogVersion()).toBe(before + 1);
    expect(seen).toHaveBeenCalledTimes(1);
    bad();
    good();
  });
});
