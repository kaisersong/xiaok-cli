/**
 * Skill install/uninstall must automatically invalidate the runner's skill
 * catalog so newly installed skills are usable without restarting the app.
 *
 * Design doc: docs/design/2026-07-28-desktop-skill-install-auto-reload.md
 *
 * Source-scan style follows tests/main/skill-routing.test.ts: the desktop
 * runner has no lightweight behavioral harness, so wiring is asserted on the
 * source while the invalidation mechanism itself is covered behaviorally in
 * skill-catalog-invalidation.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const servicesSource = readFileSync(join(__dirname, '../../electron/desktop-services.ts'), 'utf-8');
const mainSource = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf-8');

describe('skill install auto reload wiring', () => {
  it('bumps the shared catalog version from every install/uninstall entrance', () => {
    // Two agent tools (skill_install / skill_uninstall) + two settings-pane
    // services (installSkill / uninstallSkill) = at least 4 bump call sites.
    const bumps = servicesSource.match(/bumpSkillCatalogVersion\(\)/g) ?? [];
    expect(bumps.length).toBeGreaterThanOrEqual(4);
  });

  it('runner reloads the catalog when the shared version changes instead of a one-shot gate', () => {
    expect(servicesSource).not.toMatch(/let skillsLoaded = false/);
    expect(servicesSource).toContain('getSkillCatalogVersion()');
    expect(servicesSource).toMatch(/loadedSkillCatalogVersion\s*!==\s*getSkillCatalogVersion\(\)/);
  });

  it('registers the skill tool after a later reload even if the first task saw zero skills', () => {
    expect(servicesSource).toMatch(/skillToolAdded/);
  });

  it('main process broadcasts desktop:skillsChanged to the renderer on catalog change', () => {
    expect(mainSource).toContain('onSkillCatalogChanged');
    expect(mainSource).toContain("'desktop:skillsChanged'");
  });
});
