import type { ComponentProps, ReactNode } from 'react';
import type { ChatView as ActualChatView } from '../../renderer/src/components/ChatView';

// Presentation leaves only. Every event handler, state owner, GoalBar, shared
// surface and attachment decision remain production components/modules.
export function ChatView(props: ComponentProps<typeof ActualChatView>) {
  return <section aria-label="U11 actual ChatShell outputs">
    <output data-testid="display-source">{props.thread.currentTaskId}</output>
    <output data-testid="display-status">{props.status}</output>
    <output data-testid="question">{props.currentQuestion?.prompt}</output>
    <pre data-testid="history">{JSON.stringify(props.messages)}</pre>
    <pre data-testid="current-result">{JSON.stringify(props.result)}</pre>
  </section>;
}
export function TaskPanel(props: { goalContent?: ReactNode }) { return <>{props.goalContent}</>; }
export function CanvasPanel() { return null; }
const sidebar = { collapsed: false, setCollapsed: (_value: boolean) => {} };
export function useSidebarCollapse() { return sidebar; }
export function AppLayout() { return null; }
