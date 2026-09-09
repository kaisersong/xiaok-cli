import { describe, expect, it } from 'vitest'
import { referenceEscapesSkillRoot, createSkillBundleRefsTool } from '../../electron/skill-runtime.js'
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillCatalog } from '../../../src/ai/skills/loader.js'

// Use a platform-appropriate skill root so resolve()/relative() behave like the
// real host. The helper must still reject foreign-style absolute paths.
const ROOT = process.platform === 'win32' ? 'C:\\Users\\song\\.xiaok\\skills\\demo' : '/home/song/.xiaok/skills/demo'

describe('referenceEscapesSkillRoot', () => {
  it('real bundle tool refuses symlink references outside the installed skill root', async () => {
    const root=mkdtempSync(join(tmpdir(),'skill-root-')),outside=mkdtempSync(join(tmpdir(),'skill-secret-'));
    writeFileSync(join(root,'safe.md'),'safe reference');writeFileSync(join(outside,'private.md'),'PRIVATE_OUTSIDE');
    symlinkSync(outside,join(root,'escape'),'dir');
    const tool=createSkillBundleRefsTool({list:()=>[{name:'fixture',rootDir:root}]} as unknown as SkillCatalog);
    expect(await tool.execute({skillName:'fixture',paths:['safe.md']})).toContain('safe reference');
    expect(await tool.execute({skillName:'fixture',paths:['escape/private.md']})).not.toContain('PRIVATE_OUTSIDE');
  })
  it('allows ordinary relative references inside the skill root', () => {
    expect(referenceEscapesSkillRoot(ROOT, 'SKILL.md')).toBe(false)
    expect(referenceEscapesSkillRoot(ROOT, 'stages/plan.md')).toBe(false)
    expect(referenceEscapesSkillRoot(ROOT, 'references/template.md')).toBe(false)
    expect(referenceEscapesSkillRoot(ROOT, 'scripts/run.py')).toBe(false)
  })

  it('rejects POSIX absolute paths', () => {
    expect(referenceEscapesSkillRoot(ROOT, '/etc/passwd')).toBe(true)
    expect(referenceEscapesSkillRoot(ROOT, '/home/song/secret.txt')).toBe(true)
  })

  it('rejects Windows drive-letter absolute paths on any host', () => {
    expect(referenceEscapesSkillRoot(ROOT, 'C:\\Windows\\System32\\config')).toBe(true)
    expect(referenceEscapesSkillRoot(ROOT, 'D:/secrets/key.pem')).toBe(true)
    expect(referenceEscapesSkillRoot(ROOT, 'c:\\evil')).toBe(true)
  })

  it('rejects UNC paths on any host', () => {
    expect(referenceEscapesSkillRoot(ROOT, '\\\\server\\share\\file')).toBe(true)
    expect(referenceEscapesSkillRoot(ROOT, '//server/share/file')).toBe(true)
  })

  it('rejects parent-directory traversal with either separator', () => {
    expect(referenceEscapesSkillRoot(ROOT, '../outside.md')).toBe(true)
    expect(referenceEscapesSkillRoot(ROOT, '..\\outside.md')).toBe(true)
    expect(referenceEscapesSkillRoot(ROOT, 'stages/../../escape.md')).toBe(true)
    expect(referenceEscapesSkillRoot(ROOT, 'a/b/../../../escape.md')).toBe(true)
  })

  it('rejects empty references', () => {
    expect(referenceEscapesSkillRoot(ROOT, '')).toBe(true)
  })

  it('allows traversal that stays within the root', () => {
    expect(referenceEscapesSkillRoot(ROOT, 'stages/../SKILL.md')).toBe(false)
    expect(referenceEscapesSkillRoot(ROOT, './SKILL.md')).toBe(false)
  })
})
