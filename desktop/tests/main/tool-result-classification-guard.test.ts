import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression guard for tool-result classification.
//
// Two byte-identical copies of the model-facing rule (`!result.startsWith('Error')`)
// had drifted apart and neither covered the permission-decline prefix, so a tool
// call the user explicitly refused was reported to the model as a success. Both
// copies now route through `isSuccessfulModelToolResult`.
//
// This guard exists because the failure mode is *copy proliferation*, not just
// reversion: a second ad-hoc classifier added anywhere in these trees would be
// invisible in review. So the assertion is an EXACT SET match — any new
// `.startsWith('Error...')` site fails, in either polarity.
//
// Note the guard cannot protect the body of `isSuccessfulModelToolResult` itself
// (it lives in an expected file); the table-driven cases in
// tests/ai/tools/index.test.ts do that.

const repoRoot = join(__dirname, '..', '..', '..')
const SCAN_DIRS = [
  join(repoRoot, 'desktop', 'electron'),
  join(repoRoot, 'src', 'ai'),
]

// Every surviving occurrence, with why it is allowed to keep its own rule.
const EXPECTED_SITES = [
  // The sanctioned home of both classifiers (observation face + model face).
  'src/ai/tools/index.ts',
  // Artifact-path inference; already gated on `ok`, so it is redundant rather than
  // authoritative, and it answers a different question (is this bash output a path?).
  'desktop/electron/desktop-services.ts',
  // Persist-budget heuristic: decides whether to spill a tool result to disk.
  'desktop/electron/context-manager.ts',
  // Artifact-workspace producers short-circuit on their own `Error:` envelope
  // before parsing the structured plugin_unavailable payload.
  'desktop/electron/artifact-workspace-tools.ts',
]

function isScannableFile(filePath: string): boolean {
  const ext = extname(filePath)
  if (ext !== '.ts' && ext !== '.tsx') return false
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) return false
  return !filePath.endsWith('.d.ts')
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

interface Hit {
  file: string
  line: number
  text: string
}

function scan(pattern: RegExp): Hit[] {
  const hits: Hit[] = []
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((text, index) => {
        if (pattern.test(text)) {
          hits.push({
            file: relative(repoRoot, file).split('\\').join('/'),
            line: index + 1,
            text: text.trim(),
          })
        }
      })
    }
  }
  return hits
}

function format(hits: Hit[]): string {
  return hits.map(hit => `  ${hit.file}:${hit.line}  ${hit.text}`).join('\n')
}

describe('tool result classification guard', () => {
  // Per-directory, because desktop/electron alone would satisfy a global
  // threshold — a mistyped src/ai path would otherwise pass silently
  // (collectFiles swallows readdirSync failures).
  it.each(SCAN_DIRS)('finds source files to scan in %s', dir => {
    expect(collectFiles(dir).length).toBeGreaterThan(20)
  })

  it('routes desktop and CLI tool-result classification through the shared predicate', () => {
    const desktop = readFileSync(join(repoRoot, 'desktop', 'electron', 'desktop-services.ts'), 'utf8')
    const cli = readFileSync(join(repoRoot, 'src', 'ai', 'runtime', 'agent-runtime.ts'), 'utf8')
    expect(desktop).toContain('isSuccessfulModelToolResult(')
    expect(cli).toContain('isSuccessfulModelToolResult(')
  })

  it('has no tool-result classifier outside the expected set', () => {
    // Both polarities: `!x.startsWith('Error')` and `if (x.startsWith('Error'))`.
    const hits = scan(/\.startsWith\(\s*['"]Error/)
    const files = [...new Set(hits.map(hit => hit.file))].sort()
    expect(
      files,
      `A new tool-result classifier appeared. Route it through isSuccessfulModelToolResult, `
      + `or add it to EXPECTED_SITES with a reason.\n${format(hits)}`,
    ).toEqual([...EXPECTED_SITES].sort())
  })

  it('pins the cancellation prefix constant to a single producer', () => {
    const source = readFileSync(join(repoRoot, 'src', 'ai', 'tools', 'index.ts'), 'utf8')
    expect(source).toContain("export const TOOL_CANCELLED_PREFIX = '（已取消: '")
    // The decline path must build its string from the constant so the two cannot drift.
    expect(source).toContain('${TOOL_CANCELLED_PREFIX}')
  })
})
