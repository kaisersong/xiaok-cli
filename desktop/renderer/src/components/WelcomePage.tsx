import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChatInput } from './ChatInput';
import { api } from '../api';

const QUICK_PROMPTS = [
  '帮我写一篇产品调研报告',
  '生成一份竞品对比分析',
  '帮我整理会议纪要并提取待办',
  '写一份项目立项方案',
  '帮我写本周工作总结',
  '写一份介绍小K的演示文稿',
  '创建项目, 让2个智能体搞定本月国外主要AI产品动态分析',
];

function useProfileName() {
  const [name, setName] = useState(() =>
    localStorage.getItem('xiaok_display_name')
    || (window as any).xiaokDesktop?.systemUsername
    || ''
  );
  useEffect(() => {
    const handler = () => {
      setName(
        localStorage.getItem('xiaok_display_name')
        || (window as any).xiaokDesktop?.systemUsername
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

  const username = useProfileName();
  const greeting = `${username}，我们一起来搞定工作吧！`;
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

    navigate(`/t/${thread.id}`, { state: { initialPrompt: text } });
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
          placeholder="描述你的工作需求..."
        />
      </div>

      <div className="w-full max-w-2xl">
        <div data-testid="quick-prompts" className="flex flex-wrap justify-center gap-2">
          {QUICK_PROMPTS.map((p) => (
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
