import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChatInput } from './ChatInput';
import { api, type ThreadRecord } from '../api';

export function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [prompt, setPrompt] = useState('');
  const [recentThreads, setRecentThreads] = useState<ThreadRecord[]>([]);

  useEffect(() => {
    api.listThreads({ limit: 5 }).then(setRecentThreads);
  }, [location.key]);

  const handleSubmit = async (text: string, _files: Array<{ filePath: string; name: string }>) => {
    // Always create the thread first so it appears in sidebar regardless of task outcome
    const thread = await api.createThread({ title: text.slice(0, 40) });

    try {
      const { taskId } = await api.createTask({ prompt: text, materials: [] });
      await api.updateThreadTaskId(thread.id, taskId);
    } catch (e) {
      // Task creation failed (e.g., active task exists). Thread still exists, user can retry from chat.
      console.error('[WelcomePage] createTask failed:', (e as Error).message);
    }

    // Always navigate so user can see their thread
    navigate(`/t/${thread.id}`, { state: { initialPrompt: text } });
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-3xl font-medium">What do you want to build?</h1>
      <div className="w-full max-w-xl">
        <ChatInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          placeholder="Describe your task..."
        />
      </div>

      {recentThreads.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs font-medium text-[var(--c-text-secondary)]">Recent</p>
          <div className="flex flex-col gap-1">
            {recentThreads.map(thread => (
              <button
                key={thread.id}
                type="button"
                onClick={() => navigate(`/t/${thread.id}`)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--c-bg-card)]"
              >
                <span className="truncate">{thread.title || 'Untitled'}</span>
                <span className="ml-2 shrink-0 text-xs text-[var(--c-text-secondary)]">
                  {formatTime(thread.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
