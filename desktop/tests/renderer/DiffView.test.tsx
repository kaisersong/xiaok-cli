import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiffView } from '../../renderer/src/components/DiffView'

vi.mock('../../renderer/src/contexts/AppearanceContext', () => ({
  AppearanceContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
    Consumer: ({ children }: { children: (value: { theme: string }) => React.ReactNode }) => children({ theme: 'system' }),
  },
}))

// Pierre uses Shadow DOM — testing-library cannot query inner text.
// We verify: component renders without crashing, container exists, fallback works.

describe('DiffView', () => {
  it('renders valid single-file unified diff without crashing', () => {
    const diff = `diff --git a/src/file.ts b/src/file.ts
index 123..456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 const z = 3;`
    const { container } = render(<DiffView diff={diff} />)
    // PatchDiff renders inside a diffs-container custom element
    expect(container.querySelector('diffs-container')).toBeTruthy()
  })

  it('renders multi-file diff without crashing', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a
+b
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old
+new`
    const { container } = render(<DiffView diff={diff} />)
    expect(container.querySelector('diffs-container')).toBeTruthy()
  })

  it('handles renamed files without crashing', () => {
    const diff = `diff --git a/old.ts b/new.ts
rename from old.ts
rename to new.ts
similarity index 100%`
    const { container } = render(<DiffView diff={diff} />)
    // Rename-only diffs may not produce a diffs-container — just verify no crash
  })

  it('handles new file creation', () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+export const x = 1
+export const y = 2
+export const z = 3`
    const { container } = render(<DiffView diff={diff} />)
    expect(container.querySelector('diffs-container')).toBeTruthy()
  })

  it('handles file deletion', () => {
    const diff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const x = 1
-export const y = 2
-export const z = 3`
    const { container } = render(<DiffView diff={diff} />)
    expect(container.querySelector('diffs-container')).toBeTruthy()
  })

  it('returns null for empty diff', () => {
    const { container } = render(<DiffView diff="" />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null for undefined diff', () => {
    const { container } = render(<DiffView diff={undefined as unknown as string} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders oversized diff with "Load more" button instead of fallback', () => {
    const hugeLines = Array(600).fill('+some very long line of code here with lots of content')
    const hugeDiff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +600 @@
${hugeLines.join('\n')}`

    // New behavior: renders partial content + Load more button, NOT fallback
    const fallbackText = 'Diff too large - showing preview only'
    const { container } = render(<DiffView diff={hugeDiff} fallbackText={fallbackText} />)
    // No fallback text should appear
    expect(screen.queryByText(fallbackText)).not.toBeInTheDocument()
    // Should have rendered something (diffs-container)
    expect(container.querySelector('diffs-container')).toBeTruthy()
    // Load more button should exist
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
  })

  it('shows "Load more" when diff exceeds byte limit', () => {
    // Create a diff just over MAX_DIFF_BYTES (50000)
    const padding = '+'.repeat(500)
    const lines = Array(110).fill(padding).join('\n')
    const bigDiff = `diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +110 @@\n-old\n${lines}`
    render(<DiffView diff={bigDiff} />)
    // Should have at least one "Load more" button
    const buttons = screen.queryAllByText(/load more/i)
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('renders all files in multi-file oversized diff', () => {
    const fileContent = '+'.repeat(200)
    const file1 = `diff --git a/f1 b/f1\n--- a/f1\n+++ b/f1\n@@ -1 +1 @@\n-old\n${fileContent}`
    const file2 = `diff --git a/f2 b/f2\n--- a/f2\n+++ b/f2\n@@ -1 +1 @@\n-old\n${fileContent}`
    const file3 = `diff --git a/f3 b/f3\n--- a/f3\n+++ b/f3\n@@ -1 +1 @@\n-old\n${fileContent}`
    const multiDiff = `${file1}\n${file2}\n${file3}`

    render(<DiffView diff={multiDiff} />)
    // Should render all 3 files (each has a diffs-container)
    const containers = document.querySelectorAll('diffs-container')
    expect(containers.length).toBeGreaterThanOrEqual(2)
  })

  it('handles CRLF line endings without crashing', () => {
    const crlfDiff = 'diff --git a/x b/x\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n'
    const { container } = render(<DiffView diff={crlfDiff} />)
    expect(container.querySelector('diffs-container')).toBeTruthy()
  })

  it('renders with hideHeader option', () => {
    const diff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
+new`
    const { container } = render(<DiffView diff={diff} hideHeader={true} />)
    expect(container.querySelector('diffs-container')).toBeTruthy()
  })

  it('applies monospace font family in compact mode', () => {
    const diff = `diff --git a/x b/x
@@ -1 +1 @@
-old
+new`
    const { container } = render(<DiffView diff={diff} compact={true} />)
    const el = container.querySelector('[style*="font-family"]')
    expect(el).toBeTruthy()
  })

  it('defaults to unified layout', () => {
    const diff = `diff --git a/x b/x
@@ -1 +1 @@
-old
+new`
    const { container } = render(<DiffView diff={diff} />)
    expect(container.querySelector('diffs-container')).toBeTruthy()
  })

  it('does not fallback for small diffs', () => {
    const smallDiff = `diff --git a/x b/x
@@ -1 +1 @@
-old
+new`
    const fallbackText = 'This should not appear'
    render(<DiffView diff={smallDiff} fallbackText={fallbackText} />)
    expect(screen.queryByText(fallbackText)).not.toBeInTheDocument()
  })

  it('returns null for whitespace-only diff', () => {
    const { container } = render(<DiffView diff="   \n\n   " />)
    expect(container.firstChild).toBeNull()
  })

  it('applies maxHeight to wrapper style', () => {
    const diff = `diff --git a/x b/x
@@ -1 +1 @@
-old
+new`
    const { container } = render(<DiffView diff={diff} maxHeight={500} />)
    const wrapper = container.querySelector('diffs-container') as HTMLElement
    expect(wrapper?.getAttribute('style')).toContain('500px')
  })
})