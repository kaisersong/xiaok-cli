// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { loadSkills, type SkillLoadOptions } from '../../../src/ai/skills/loader.js';
const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'skill-discovery-owned-')); roots.push(root); const config = join(root, 'config'), dir = join(config, 'skills'); mkdirSync(dir, { recursive: true }); return { root, config, dir }; }
it('observes a malformed own skill while retaining the exact default CLI skip behavior', async () => {
  const f = fixture(); writeFileSync(join(f.dir, 'broken.md'), 'not a skill frontmatter'); const issues: unknown[] = [];
  const options = { builtinRoots: [], onDiscoveryIssue: (issue: unknown) => issues.push(issue) } as SkillLoadOptions;
  expect(await loadSkills(f.config, f.root, options)).toEqual([]); expect(issues).toHaveLength(1); expect(issues[0]).toMatchObject({ kind: 'skill_parse_invalid' });
  expect(await loadSkills(f.config, f.root, { builtinRoots: [] })).toEqual([]);
});
it('distinguishes real non-directory roots from absent roots for the Desktop observer', async () => {
  const f = fixture(), issues: unknown[] = []; rmSync(f.dir, { recursive: true }); writeFileSync(f.dir, 'owned-file'); const options = { builtinRoots: [], onDiscoveryIssue: (issue: unknown) => issues.push(issue) } as SkillLoadOptions;
  expect(await loadSkills(f.config, f.root, options)).toEqual([]); expect(issues).toHaveLength(1); expect(issues[0]).toMatchObject({ kind: 'directory_unavailable' });
  rmSync(f.dir); issues.length = 0; expect(await loadSkills(f.config, f.root, options)).toEqual([]); expect(issues).toEqual([]);
});

it.each(['directory', 'skill-file', 'resource-directory'] as const)('observes a real unreadable %s in an owned directory', async kind => {
  const f = fixture(), skill = join(f.dir, 'owned'), issues: Array<{ kind: string; path: string }> = [];
  mkdirSync(skill); const skillFile = join(skill, 'SKILL.md'); writeFileSync(skillFile, '---\nname: owned\ndescription: Owned fixture\n---\nOwned instructions.');
  const resource = join(skill, 'scripts'); mkdirSync(resource); writeFileSync(join(resource, 'owned.txt'), 'owned');
  const target = kind === 'directory' ? f.dir : kind === 'skill-file' ? skillFile : resource;
  chmodSync(target, 0);
  try {
    await loadSkills(f.config, f.root, { builtinRoots: [], onDiscoveryIssue: issue => issues.push(issue) });
    expect(issues.some(issue => issue.kind === (kind === 'directory' ? 'directory_unavailable' : kind === 'skill-file' ? 'skill_read_unavailable' : 'resource_discovery_unavailable'))).toBe(true);
  } finally { chmodSync(target, kind === 'skill-file' ? 0o600 : 0o700); }
});
