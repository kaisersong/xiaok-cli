import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatInput } from './ChatInput';
import { createThread, createTask } from '../api';

export function WelcomePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');

  const handleSubmit = async (text: string) => {
    const thread = await createThread({ title: text.slice(0, 40) });
    await createTask({ prompt: text, materials: [] });
    navigate(`/t/${thread.id}`);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-3xl font-medium">What do you want to build?</h1>
      <ChatInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={handleSubmit}
        placeholder="Describe your task..."
      />
    </div>
  );
}