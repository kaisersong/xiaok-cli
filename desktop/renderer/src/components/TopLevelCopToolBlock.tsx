import type { CodeExecutionRef } from '../storage'
import type { TodoWriteRef } from '../copSegmentTimeline'
import type { CodeExecution } from './CodeExecutionCard'
import { CodeExecutionCard } from './CodeExecutionCard'
import { ExecutionCard } from './ExecutionCard'
import { TodoListCard } from './TodoListCard'

export type TopLevelCopToolEntry =
  | { kind: 'code'; id: string; seq: number; item: CodeExecutionRef }
  | { kind: 'todo'; id: string; seq: number; item: TodoWriteRef }

export function TopLevelCopToolBlock({
  entry,
  live,
  onOpenCodeExecution,
  activeCodeExecutionId,
}: {
  entry: TopLevelCopToolEntry
  live?: boolean
  onOpenCodeExecution?: (ce: CodeExecution) => void
  activeCodeExecutionId?: string
}) {
  if (entry.kind === 'todo') {
    return <TodoListCard todo={entry.item} />
  }

  const ce = entry.item
  return (
    <div style={{ padding: '4px 0' }}>
      {ce.language === 'shell'
        ? (
          <ExecutionCard
            variant="shell"
            displayDescription={ce.displayDescription}
            code={ce.code}
            output={ce.output}
            status={ce.status}
            errorMessage={ce.errorMessage}
            smooth={!!live && ce.status === 'running'}
          />
        )
        : (
          <CodeExecutionCard
            language={ce.language}
            code={ce.code}
            output={ce.output}
            errorMessage={ce.errorMessage}
            status={ce.status}
            onOpen={onOpenCodeExecution ? () => onOpenCodeExecution(ce) : undefined}
            isActive={activeCodeExecutionId === ce.id}
          />
        )
      }
    </div>
  )
}
