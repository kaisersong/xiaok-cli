import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatView } from '../../renderer/src/components/ChatView';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
vi.mock('../../renderer/src/components/ChatInput', () => ({ ChatInput: () => <textarea aria-label="real-composer-slot" /> }));
afterEach(cleanup);
const thread = { id: 'assistant', title: 'Assistant', status: 'idle' as const, mode: 'work' as const, createdAt: 1, updatedAt: 1, starred: false, gtdBucket: 'inbox' as const, pinnedAt: null, currentTaskId: null, taskIds: [] };
const props = { thread, messages: [], streamingText: '', status: 'idle' as const, currentQuestion: null, result: null, generatedFiles: [], prompt: '', onPromptChange: vi.fn(), onSubmit: vi.fn(), onAnswer: vi.fn(), onCancel: vi.fn(), canvasOpen: false, onToggleCanvas: vi.fn(), emptyContent: <div>assistant-entry</div>, conversationHeader: <div>compact-assistant-card</div> };
it('keeps one composer visible alongside the no-message entry', () => {
 render(<LocaleProvider><ChatView {...props} /></LocaleProvider>);
 expect(screen.getByText('assistant-entry')).toBeVisible(); expect(screen.queryByText('compact-assistant-card')).toBeNull(); expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('replaces the entry with the compact card as soon as conversation starts, keeping the composer', () => {
 const ui = (messages: typeof props.messages | Array<{id:string;role:'user';content:string}>) => <LocaleProvider><ChatView {...props} messages={messages} /></LocaleProvider>;
 const view = render(ui([])); view.rerender(ui([{id:'u1',role:'user',content:'Help me plan today'}]));
 expect(screen.queryByText('assistant-entry')).toBeNull(); expect(screen.getByText('compact-assistant-card')).toBeVisible(); expect(screen.getByText('Help me plan today')).toBeVisible(); expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('does not show the empty entry over running or failed conversation state', () => {
 const view=render(<LocaleProvider><ChatView {...props} status="running" /></LocaleProvider>); expect(screen.queryByText('assistant-entry')).toBeNull();
 view.rerender(<LocaleProvider><ChatView {...props} status="failed" /></LocaleProvider>); expect(screen.queryByText('assistant-entry')).toBeNull(); expect(screen.getByText('compact-assistant-card')).toBeVisible();
});
it('opens the no-message entry at the top instead of scrolling to the end of its setup content',()=>{
 vi.spyOn(Element.prototype,'scrollHeight','get').mockReturnValue(1400);const scroll=vi.spyOn(Element.prototype,'scrollTo');
 render(<LocaleProvider><ChatView {...props}/></LocaleProvider>);expect(scroll).not.toHaveBeenCalledWith(expect.objectContaining({top:1400}));vi.restoreAllMocks();
});
