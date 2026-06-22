import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChatInput } from './ChatInput';
import { api } from '../api';
import { getDesktopApi } from '../shared/desktop';
import { useLocale } from '../contexts/LocaleContext';

function useProfileName() {
  const [name, setName] = useState(() =>
    localStorage.getItem('xiaok_display_name')
    || getDesktopApi()?.systemUsername
    || ''
  );
  useEffect(() => {
    const handler = () => {
      setName(
        localStorage.getItem('xiaok_display_name')
        || getDesktopApi()?.systemUsername
        || ''
      );
    };
    window.addEventListener('xiaok-profile-changed', handler);
    return () => window.removeEventListener('xiaok-profile-changed', handler);
  }, []);
  return name;
}

function useTypewriter(text: string, speed = 80) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    indexRef.current = 0;
    if (!text) return;

    const timer = setInterval(() => {
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(timer);
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed]);

  return displayed;
}

export function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [prompt, setPrompt] = useState('');
  const { t } = useLocale();

  const username = useProfileName();
  const greeting = `${username}${t.welcome.greetingSuffix}`;
  const typedGreeting = useTypewriter(greeting, 60);

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>) => {
    const thread = await api.createThread({ title: text.slice(0, 40) });

    try {
      let taskId: string;
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.filePath);
        const result = await api.createTaskWithFiles({ prompt: text, filePaths });
        taskId = result.taskId;
      } else {
        const result = await api.createTask({ prompt: text, materials: [] });
        taskId = result.taskId;
      }
      await api.updateThreadTaskId(thread.id, taskId);
    } catch (e) {
      console.error('[WelcomePage] createTask failed:', (e as Error).message);
    }

    navigate(`/t/${thread.id}`, {
      state: {
        initialPrompt: text,
        ...(files && files.length > 0
          ? { initialFiles: files.map(file => ({ filePath: file.filePath, name: file.name })) }
          : {}),
      },
    });
  };

  const handleQuickPrompt = (p: string) => {
    setPrompt(p);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-3xl font-medium min-h-[2.5rem]">{typedGreeting}</h1>
      <div className="w-full max-w-xl">
        <ChatInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          placeholder={t.welcome.inputPlaceholder}
          autoFocus
        />
      </div>

      <div className="w-full max-w-2xl">
        <div data-testid="quick-prompts" className="flex flex-wrap justify-center gap-2">
          {t.welcome.quickPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handleQuickPrompt(p)}
              title={p}
              className="rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)] hover:bg-[var(--c-bg-card)] whitespace-nowrap"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
