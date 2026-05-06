import { useMemo, useCallback } from 'react'
import { useFileTree, FileTree } from '@pierre/trees/react'
import type { ToolStep } from './ChatView'

interface Props {
  steps: ToolStep[]
  onFileSelect?: (filePath: string) => void
}

function isFileTool(name: string): boolean {
  return name === 'edit' || name === 'Edit' || name === 'edit_file' || name === 'Write'
}

function getFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  return typeof obj.file_path === 'string' ? obj.file_path : null
}

function toRelativePath(absPath: string): string {
  const cwd = '/Users/song/projects/xiaok-cli/'
  return absPath.startsWith(cwd) ? absPath.slice(cwd.length) : absPath
}

export function ChangedFilesTree({ steps, onFileSelect }: Props) {
  const { paths, gitStatusEntries } = useMemo(() => {
    const fileSet = new Map<string, 'added' | 'modified'>()
    for (const step of steps) {
      if (!isFileTool(step.toolName) || step.status === 'running') continue
      const fp = getFilePath(step.input)
      if (!fp) continue
      const rel = toRelativePath(fp)
      if (!fileSet.has(rel)) {
        fileSet.set(rel, step.toolName === 'Write' ? 'added' : 'modified')
      }
    }
    const sorted = [...fileSet.keys()].sort()
    const entries = sorted.map((path) => ({ path, status: fileSet.get(path)! }))
    return { paths: sorted, gitStatusEntries: entries }
  }, [steps])

  const handleSelectionChange = useCallback(
    (paths: readonly string[]) => {
      if (paths.length > 0 && onFileSelect) {
        onFileSelect(paths[0])
      }
    },
    [onFileSelect],
  )

  const { model } = useFileTree({
    paths,
    gitStatus: gitStatusEntries,
    icons: 'minimal',
    density: 'compact',
    flattenEmptyDirectories: true,
    onSelectionChange: handleSelectionChange,
    initialExpansion: 1,
  })

  if (paths.length === 0) return null

  return (
    <div
      style={{
        height: Math.max(40, Math.min(paths.length * 24 + 16, 160)),
        background: 'var(--c-bg-deep)',
        borderRadius: 4,
        marginTop: 2,
        marginBottom: 4,
      }}
    >
      <FileTree model={model} style={{ height: '100%' }} />
    </div>
  )
}
