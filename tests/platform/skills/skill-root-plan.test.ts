import { describe, expect, it } from 'vitest';
import {
  assertPlanIsClosed,
  reduceSkillPlan,
  TrustedSkillContractConflictError,
  type SkillCandidate,
  type SkillRootPlan,
} from '../../../src/platform/skills/skill-root-plan.js';

/**
 * Design v58 §4.4 / R47-01 / R48-02 / R49-01. Production today mixes
 * name-last-write-wins with alias-first-match, so the winner depends on
 * enumeration order; these tests freeze a single deterministic reducer.
 */
const ROOTS = {
  builtin: '/app/builtin/skills',
  reservedCua: '/store/managed/cua-computer-use/repo/skills',
  reservedReport: '/store/managed/kai-report-creator/repo/skills',
  plugin: '/home/u/.xiaok/plugins/third-party/skills',
  global: '/home/u/.xiaok/skills',
  project: '/work/proj/.xiaok/skills',
};

function mainPlan(): SkillRootPlan {
  return {
    consumer: 'main',
    roots: [
      { path: ROOTS.builtin, provenance: 'builtin' },
      { path: ROOTS.reservedCua, provenance: 'reserved' },
      { path: ROOTS.reservedReport, provenance: 'reserved' },
      { path: ROOTS.plugin, provenance: 'plugin' },
      { path: ROOTS.global, provenance: 'global' },
      { path: ROOTS.project, provenance: 'project' },
    ],
    reservedLoaded: ['computer-use', 'report-planner'],
    reservedDenied: [],
  };
}

function kswarmPlan(): SkillRootPlan {
  return {
    consumer: 'kswarm',
    roots: [
      { path: ROOTS.builtin, provenance: 'builtin' },
      { path: ROOTS.reservedReport, provenance: 'reserved' },
      { path: ROOTS.plugin, provenance: 'plugin' },
      { path: ROOTS.global, provenance: 'global' },
      { path: ROOTS.project, provenance: 'project' },
    ],
    reservedLoaded: ['report-planner'],
    // KSwarm deliberately has no CUA gateway, so nothing may claim its name.
    reservedDenied: ['computer-use', 'cua'],
  };
}

function skill(
  name: string,
  provenance: SkillCandidate['provenance'],
  rootPath: string,
  aliases: string[] = [],
  relativePath = `${name}/SKILL.md`,
): SkillCandidate {
  return { name, aliases, provenance, rootPath, relativePath: `${rootPath}/${relativePath}` };
}

describe('SkillRootPlan reducer — reserved protection', () => {
  it('keeps reserved skills and drops a plugin skill that reuses the name', () => {
    const candidates = [
      skill('report-planner', 'reserved', ROOTS.reservedReport),
      skill('report-planner', 'plugin', ROOTS.plugin),
    ];

    const result = reduceSkillPlan(mainPlan(), candidates);

    expect(result.skills.map((s) => s.rootPath)).toEqual([ROOTS.reservedReport]);
    expect(result.diagnostics).toEqual([{
      code: 'reserved_skill_name_conflict',
      path: `${ROOTS.plugin}/report-planner/SKILL.md`,
      key: 'report-planner',
      provenance: 'plugin',
      consumer: 'main',
    }]);
  });

  it('drops a project skill whose alias collides with a reserved name', () => {
    const candidates = [
      skill('report-planner', 'reserved', ROOTS.reservedReport),
      skill('my-reporter', 'project', ROOTS.project, ['report-planner']),
    ];

    const result = reduceSkillPlan(mainPlan(), candidates);

    expect(result.skills).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'reserved_skill_name_conflict', key: 'report-planner' });
  });

  it('lets KSwarm deny-reserve a skill it does not even load', () => {
    const candidates = [
      skill('report-planner', 'reserved', ROOTS.reservedReport),
      skill('computer-use', 'plugin', ROOTS.plugin),
      skill('sneaky', 'global', ROOTS.global, ['cua']),
    ];

    const result = reduceSkillPlan(kswarmPlan(), candidates);

    expect(result.skills.map((s) => s.name)).toEqual(['report-planner']);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'denied_reserved_skill_impersonation',
      'denied_reserved_skill_impersonation',
    ]);
  });

  it('fails closed when two reserved skills collide', () => {
    const candidates = [
      skill('report-planner', 'reserved', ROOTS.reservedReport),
      skill('computer-use', 'reserved', ROOTS.reservedCua, ['report-planner']),
    ];

    expect(() => reduceSkillPlan(mainPlan(), candidates)).toThrow(TrustedSkillContractConflictError);
  });
});

describe('SkillRootPlan reducer — nonreserved priority', () => {
  it('freezes project > global > plugin > builtin', () => {
    const candidates = [
      skill('helper', 'builtin', ROOTS.builtin),
      skill('helper', 'plugin', ROOTS.plugin),
      skill('helper', 'global', ROOTS.global),
      skill('helper', 'project', ROOTS.project),
    ];

    const result = reduceSkillPlan(mainPlan(), candidates);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].provenance).toBe('project');
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics.every((d) => d.code === 'legacy_skill_name_conflict')).toBe(true);
  });

  it('produces the same winner regardless of enumeration order', () => {
    const candidates = [
      skill('helper', 'builtin', ROOTS.builtin),
      skill('helper', 'plugin', ROOTS.plugin),
      skill('helper', 'global', ROOTS.global),
    ];

    const forward = reduceSkillPlan(mainPlan(), candidates);
    const reversed = reduceSkillPlan(mainPlan(), [...candidates].reverse());

    expect(forward.skills[0].provenance).toBe(reversed.skills[0].provenance);
    expect(forward.skills[0].relativePath).toBe(reversed.skills[0].relativePath);
    expect(forward.diagnostics.length).toBe(reversed.diagnostics.length);
  });

  it('breaks a same-priority tie by normalised path, stably', () => {
    const a = skill('dup', 'plugin', ROOTS.plugin, [], 'a-dup/SKILL.md');
    const b = skill('dup', 'plugin', ROOTS.plugin, [], 'b-dup/SKILL.md');

    const forward = reduceSkillPlan(mainPlan(), [a, b]);
    const reversed = reduceSkillPlan(mainPlan(), [b, a]);

    expect(forward.skills[0].relativePath).toBe(a.relativePath);
    expect(reversed.skills[0].relativePath).toBe(a.relativePath);
  });

  it('resolves alias-to-alias collisions between nonreserved skills deterministically', () => {
    const candidates = [
      skill('alpha', 'global', ROOTS.global, ['shared-alias']),
      skill('beta', 'plugin', ROOTS.plugin, ['shared-alias']),
    ];

    const result = reduceSkillPlan(mainPlan(), candidates);

    expect(result.skills.map((s) => s.name)).toEqual(['alpha']);
    expect(result.diagnostics[0]).toMatchObject({ code: 'legacy_skill_name_conflict', key: 'shared-alias' });
  });

  it('keeps every non-colliding skill from all four nonreserved provenances', () => {
    const candidates = [
      skill('report-planner', 'reserved', ROOTS.reservedReport),
      skill('b-builtin', 'builtin', ROOTS.builtin),
      skill('c-plugin', 'plugin', ROOTS.plugin),
      skill('d-global', 'global', ROOTS.global),
      skill('e-project', 'project', ROOTS.project),
    ];

    const result = reduceSkillPlan(mainPlan(), candidates);

    expect(result.skills.map((s) => s.name).sort()).toEqual(
      ['b-builtin', 'c-plugin', 'd-global', 'e-project', 'report-planner'],
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores candidates from roots outside the plan (explicit-plan-only)', () => {
    const outside = skill('rogue', 'plugin', '/tmp/not-in-plan');

    const result = reduceSkillPlan(mainPlan(), [outside]);

    expect(result.skills).toEqual([]);
  });

  it('never emits a name or alias twice', () => {
    const candidates = [
      skill('report-planner', 'reserved', ROOTS.reservedReport, ['report']),
      skill('other', 'project', ROOTS.project, ['report']),
      skill('third', 'global', ROOTS.global, ['third-alias']),
    ];

    const result = reduceSkillPlan(mainPlan(), candidates);
    const keys = result.skills.flatMap((s) => [s.name, ...s.aliases]);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('SkillRootPlan closure guard', () => {
  it('rejects a plan that silently omits a provenance', () => {
    const plan: SkillRootPlan = {
      consumer: 'settings',
      roots: [{ path: ROOTS.builtin, provenance: 'builtin' }],
      reservedLoaded: [],
      reservedDenied: [],
    };

    expect(() => assertPlanIsClosed(plan, ['builtin', 'global', 'project']))
      .toThrow(/skill_root_plan_incomplete: missing provenance global, project/);
  });

  it('accepts the fully materialised main plan', () => {
    expect(() => assertPlanIsClosed(mainPlan(), ['builtin', 'reserved', 'plugin', 'global', 'project']))
      .not.toThrow();
  });
});
