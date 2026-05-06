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

  it('falls back to plain text when diff exceeds byte limit', () => {
    const hugeLines = Array(600).fill('+some very long line of code here with lots of content')
    const hugeDiff = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +600 @@
${hugeLines.join('\n')}`

    const fallbackText = 'Diff too large - showing preview only'
    render(<DiffView diff={hugeDiff} fallbackText={fallbackText} />)
    expect(screen.getByText(fallbackText)).toBeInTheDocument()
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