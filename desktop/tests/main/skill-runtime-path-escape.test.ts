import { describe, expect, it } from 'vitest'
import { referenceEscapesSkillRoot } from '../../electron/skill-runtime.js'

// Use a platform-appropriate skill root so resolve()/relative() behave like the
// real host. The helper must still reject foreign-style absolute paths.
const ROOT = process.platform === 'win32' ? 'C:\\Users\\song\\.xiaok\\skills\\demo' : '/home/song/.xiaok/skills/demo'

describe('referenceEscapesSkillRoot', () => {
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
