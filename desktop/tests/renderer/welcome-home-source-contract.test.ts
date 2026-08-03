import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const COMPONENT_ROOT = resolve(process.cwd(), 'renderer/src/components');
const LOCALE_ROOT = resolve(process.cwd(), 'renderer/src/locales');

function welcomeLocaleBlock(source: string): string {
  const start = source.indexOf('// welcome page');
  const end = source.indexOf('// knowledge page');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);
  expect(block).toContain('welcome:');
  return block;
}

function staticClassTokens(source: string, pattern: RegExp): Set<string> {
  const match = source.match(pattern);
  expect(match, `missing static className for ${pattern}`).not.toBeNull();
  return new Set(match![1].trim().split(/\s+/));
}

describe('welcome home source contract', () => {
  it('does not restore the A/B comparison production path', () => {
    const welcomePage = readFileSync(resolve(COMPONENT_ROOT, 'WelcomePage.tsx'), 'utf8');
    const projection = readFileSync(resolve(COMPONENT_ROOT, 'welcome-home-projection.ts'), 'utf8');
    const locales = ['index.ts', 'zh.ts', 'en.ts']
      .map(file => {
        const source = readFileSync(resolve(LOCALE_ROOT, file), 'utf8');
        return welcomeLocaleBlock(source);
      })
      .join('\n');

    expect(welcomePage).not.toMatch(/HomeVariant|HomeVariantSwitch|ControlPlaneFirstHome|function ProjectList|function SectionHeader|welcome-home-[ab]|HOME_VARIANT_STORAGE_KEY|xiaok:welcome-home-variant/);
    expect(projection).not.toMatch(/WelcomeProjectItem|automationFailures|projectProgress|toProjectItem|projectAttentionRank|^  activeProjects:/m);
    expect(locales).not.toMatch(/variantSelector|variantA:|variantB:|controlPlaneSubtitle|needsYou:|inProgress:|automationStatus:|noActiveProjects:|progressing:|automationFailureSummary:|openProjectWithStatus:|viewAllProjects:/);
  });

  it('keeps the approved responsive whitespace without adding a page scroll owner', () => {
    const welcomePage = readFileSync(resolve(COMPONENT_ROOT, 'WelcomePage.tsx'), 'utf8');
    const outerClasses = staticClassTokens(
      welcomePage,
      /return \(\s*<div className="([^"]+)">\s*<ConversationFirstHome/,
    );
    const homeClasses = staticClassTokens(
      welcomePage,
      /data-testid="welcome-home" className="([^"]+)"/,
    );
    const overviewClasses = staticClassTokens(
      welcomePage,
      /<section className="([^"]+)" aria-labelledby="welcome-overview-title"/,
    );

    expect(outerClasses).toContain('pt-[clamp(4rem,12vh,6.25rem)]');
    expect(outerClasses).not.toContain('pt-5');
    expect(outerClasses).not.toContain('pb-8');
    expect(outerClasses).not.toContain('pb-24');
    expect(homeClasses).toContain('pb-24');
    expect(overviewClasses).toContain('mt-[clamp(5rem,15vh,8rem)]');
    expect(overviewClasses).not.toContain('mt-7');
    expect(welcomePage).not.toMatch(/\boverflow(?:-[xy])?-(?:auto|scroll)\b/);
  });
});
