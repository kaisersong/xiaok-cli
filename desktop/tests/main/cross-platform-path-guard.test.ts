import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression guard against the class of Windows-incompatible path handling that
// repeatedly caused bugs (artifact cards not rendering, HTML edits not saving,
// hardcoded mac paths). It scans desktop source for known anti-patterns so they
// fail fast in review instead of silently breaking only on Windows.
//
// The fixes live in:
//   - renderer: desktop/renderer/src/lib/file-path.ts (toFileUrl / fileBasename / isAbsoluteFilePath)
//   - main:     node:path basename/resolve/relative/isAbsolute
// New code must use those helpers instead of hand-rolling separators or URLs.

const repoDesktopRoot = join(__dirname, '..', '..')
const SCAN_DIRS = [
  join(repoDesktopRoot, 'electron'),
  join(repoDesktopRoot, 'renderer', 'src'),
]

// file-path.ts is the sanctioned place to build file:// URLs and to document
// example POSIX paths, so it is exempt from these scans.
const EXEMPT_SUFFIXES = [
  join('renderer', 'src', 'lib', 'file-path.ts'),
]

function isScannableFile(filePath: string): boolean {
  const ext = extname(filePath)
  if (ext !== '.ts' && ext !== '.tsx') return false
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) return false
  if (filePath.endsWith('.d.ts')) return false
  return !EXEMPT_SUFFIXES.some(suffix => filePath.endsWith(suffix))
}

function collectFiles(dir: string): string[] {
  const out: string[] = []
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      out.push(...collectFiles(full))
    } else if (entry.isFile() && isScannableFile(full)) {
      out.push(full)
    }
  }
  return out
}

interface Violation {
  file: string
  line: number
  text: string
}

function scan(pattern: RegExp): Violation[] {
  const violations: Violation[] = []
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        pattern.lastIndex = 0
        if (pattern.test(line)) {
          violations.push({ file: relative(repoDesktopRoot, file), line: i + 1, text: line.trim().slice(0, 120) })
        }
      })
    }
  }
  return violations
}

function format(violations: Violation[]): string {
  return violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n')
}

describe('cross-platform path guard', () => {
  it('finds desktop source files to scan', () => {
    const count = SCAN_DIRS.reduce((sum, dir) => sum + collectFiles(dir).length, 0)
    expect(count).toBeGreaterThan(50)
  })

  it('forbids hand-built `file://${...}` template literals (use toFileUrl / pathToFileUri)', () => {
    const violations = scan(/`file:\/\/\$\{/)
    expect(violations, `Hand-built file:// URLs break on Windows (file://D:\\...). Use toFileUrl().\n${format(violations)}`).toEqual([])
  })

  it('forbids string literals that start with a hardcoded home directory path', () => {
    // Catches `const cwd = '/Users/song/...'` style hardcoding. Allows example
    // paths that appear mid-sentence inside prompt/help strings.
    const violations = scan(/['"`]\/(Users|home)\//)
    expect(violations, `Hardcoded home paths are wrong on Windows and on other machines. Derive paths at runtime.\n${format(violations)}`).toEqual([])
  })

  it('forbids hardcoded Windows drive-letter path literals in source', () => {
    // e.g. 'C:\\Users\\song\\...'. Drive letters in code are machine-specific.
    const violations = scan(/['"`][A-Za-z]:\\\\(Users|Windows|Program)/)
    expect(violations, `Hardcoded Windows drive paths are machine-specific. Derive paths at runtime.\n${format(violations)}`).toEqual([])
  })
})
