import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatView, type ChatMessage } from '../../renderer/src/components/ChatView';
import { ChatRightSurface } from '../../renderer/src/components/ChatRightSurface';
import '../../renderer/src/components/multi-agent-panel.css';
import type { ThreadRecord } from '../../renderer/src/api/types';

const thread: ThreadRecord = { id: 'scroll-layout', title: 'Native scroll boundary', status: 'completed', mode: 'chat',
  createdAt: 1, updatedAt: 1, starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: 'task-layout', taskIds: ['task-layout'] };
const messages: ChatMessage[] = Array.from({ length: 12 }, (_, index) => [
  { id: `user-${index}`, role: 'user' as const, content: `第 ${index + 1} 次提问\n${'检查本会话的滚动边界。'.repeat(35)}` },
  { id: `assistant-${index}`, role: 'assistant' as const, content: `第 ${index + 1} 次回答\n\n${'真实浏览器输出行。 '.repeat(60)}` },
]).flat();
function App() {
  const [streamingText, setStreamingText] = useState('初始尾部');
  const [prompt, setPrompt] = useState('');
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasVisible, setCanvasVisible] = useState(false);
  return <LocaleProvider><div className="flex h-screen flex-col overflow-hidden">
    <header style={{ height: 52, flexShrink: 0 }}><button type="button" onClick={() => setStreamingText(value => `${value}\n${'后续流式输出 '.repeat(70)}`)}>Append stream</button></header>
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-testid="layout-parent">
      <ChatRightSurface threadId={thread.id} agentCount={2} canvasOpen={canvasOpen} canvasRequestId={0} canvasExpanded={false}
        taskContent={<p>Task details</p>} agentsContent={<div className="multi-agent-panel">
          {/* The actual Panel ends with this absolute sr-only live region. Keep
              its production CSS/static-position boundary after tall contents;
              no Panel lifecycle/permissions are reimplemented by this fixture. */}
          <div style={{ height: 960 }}>Expanded execution details</div>
          <button type="button" data-testid="right-tail">Last resource control</button>
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">Resource detail expanded</span>
        </div>}
        canvasContent={canvasOpen ? <button type="button" onClick={() => setCanvasOpen(false)}>Close Canvas content</button> : undefined}
        onCanvasVisibilityChange={setCanvasVisible}>
        <ChatView thread={thread} messages={messages} streamingText={streamingText} status="completed"
          currentQuestion={null} result={null} generatedFiles={[]} prompt={prompt} onPromptChange={setPrompt}
          onSubmit={() => false} onAnswer={() => undefined} onCancel={() => undefined}
          canvasOpen={canvasVisible} onToggleCanvas={() => setCanvasOpen(value => !value)} />
      </ChatRightSurface>
    </main>
  </div></LocaleProvider>;
}
localStorage.setItem('xiaok:locale', 'zh');
createRoot(document.getElementById('root')!).render(<App />);
