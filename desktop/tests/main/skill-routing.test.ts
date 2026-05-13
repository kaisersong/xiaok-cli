/**
 * Skill routing tests: verify that hardcoded intent matching has been removed
 * and correct routing paths (slash commands, LLM tool call) remain intact.
 *
 * Design doc: docs/design/2026-05-12-remove-skill-hardcoded-routing.md
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_PATH = join(__dirname, '../../electron/desktop-services.ts');
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('skill routing: hardcoded matching removed', () => {
  it('does not contain INTENT_KEYWORD_MAP', () => {
    expect(source).not.toContain('INTENT_KEYWORD_MAP');
  });

  it('does not contain matchSkillByIntent function', () => {
    expect(source).not.toContain('matchSkillByIntent');
  });

  it('does not contain extractKeywords helper for intent matching', () => {
    // extractKeywords was used solely for Phase 2 description-based matching
    expect(source).not.toContain('EXTRACTION_STOP_WORDS');
    expect(source).not.toMatch(/function extractKeywords/);
  });

  it('does not contain auto-match skill injection pattern', () => {
    // The auto-match branch had this specific pattern
    expect(source).not.toMatch(/Auto-match:.*user-invocable skill/);
    expect(source).not.toMatch(/autoSkill\s*=\s*matchSkillByIntent/);
  });
});

describe('skill routing: correct paths preserved', () => {
  it('retains slash command skill injection via parseSlashCommand', () => {
    expect(source).toContain('parseSlashCommand');
    expect(source).toContain('findSkillByCommandName');
  });

  it('retains createSkillTool registration for LLM tool call path', () => {
    expect(source).toContain('createSkillTool');
    expect(source).toMatch(/skillTool\s*=\s*createSkillTool/);
  });

  it('retains skill_bundle_refs tool registration', () => {
    expect(source).toContain('createSkillBundleRefsTool');
  });

  it('retains formatSkillsContext for system prompt skill listing', () => {
    expect(source).toContain('formatSkillsContext');
  });

  it('retains skill tool call detection for stats tracking', () => {
    // L1682-1698: when LLM calls skill tool, track it
    expect(source).toMatch(/toolCall\.name\s*===\s*'skill'/);
    expect(source).toContain('skillTriggerType');
  });

  it('slash command path injects skill content into effectivePrompt', () => {
    // Slash path should still inject content (user explicitly invoked)
    expect(source).toMatch(/Execute skill ".*?skill\.content/);
  });
});
