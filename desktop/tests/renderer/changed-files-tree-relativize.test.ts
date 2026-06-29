import { describe, expect, it } from 'vitest'
import { relativizePaths } from '../../renderer/src/lib/file-path'

describe('relativizePaths', () => {
  it('strips the longest common POSIX directory prefix', () => {
    expect(relativizePaths([
      '/Users/song/projects/xiaok-cli/desktop/a.ts',
      '/Users/song/projects/xiaok-cli/desktop/sub/b.ts',
    ])).toEqual(['a.ts', 'sub/b.ts'])
  })

  it('strips the common Windows directory prefix and normalizes separators', () => {
    expect(relativizePaths([
      'D:\\projects\\xiaok-cli\\desktop\\a.ts',
      'D:\\projects\\xiaok-cli\\desktop\\sub\\b.ts',
    ])).toEqual(['a.ts', 'sub/b.ts'])
  })

  it('does not depend on any hardcoded project root', () => {
    // A path under an arbitrary root must still be relativized, unlike the old
    // hardcoded `/Users/song/projects/xiaok-cli/` behaviour.
    expect(relativizePaths([
      'E:\\work\\acme\\report.html',
      'E:\\work\\acme\\notes.md',
    ])).toEqual(['report.html', 'notes.md'])
  })

  it('keeps the file name when a single path is relativized to its basename', () => {
    expect(relativizePaths(['/tmp/only.md'])).toEqual(['only.md'])
  })

  it('strips only the shared root when top-level directories differ', () => {
    expect(relativizePaths([
      '/var/a.ts',
      '/etc/b.ts',
    ])).toEqual(['var/a.ts', 'etc/b.ts'])
  })

  it('handles an empty input', () => {
    expect(relativizePaths([])).toEqual([])
  })
})
