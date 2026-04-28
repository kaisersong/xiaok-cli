import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSkillAdherenceStore } from '../../../src/runtime/skills/adherence-store.js';

describe('skill adherence store', () => {
  let rootDir: string;
  let filePath: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-skill-adherence-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filePath = join(rootDir, 'adherence.json');
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('records pass/fail counts and failure reasons per skill', () => {
    const store = new FileSkillAdherenceStore(filePath);

    store.record('release-checklist', {
      passed: false,
      missingReferences: ['references/principles.md'],
      missingScripts: [],
      missingSteps: ['run_required_scripts'],
      failedChecks: [],
      checkedAt: 100,
    });
    store.record('release-checklist', {
      passed: true,
      missingReferences: [],
      missingScripts: [],
      missingSteps: [],
      failedChecks: [],
      checkedAt: 200,
    });

    expect(store.loadAll()).toEqual([
      {
        skillName: 'release-checklist',
        passedCount: 1,
        failedCount: 1,
        failedByReason: {
          missingReferences: 1,
          missingSteps: 1,
        },
        updatedAt: 200,
      },
    ]);
  });
});
