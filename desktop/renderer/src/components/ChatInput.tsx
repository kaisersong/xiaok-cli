import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Plus } from 'lucide-react';

interface ChatInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSubmit, placeholder = 'Type a message...', disabled }: ChatInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (value !== undefined) {
      setInternalValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [internalValue]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInternalValue(newValue);
    onChange?.(newValue);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (internalValue.trim()) {
        onSubmit(internalValue.trim());
        setInternalValue('');
        onChange?.('');
      }
    }
  };

  const handleSend = () => {
    if (internalValue.trim()) {
      onSubmit(internalValue.trim());
      setInternalValue('');
      onChange?.('');
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3">
      <button type="button" className="p-1 text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]" disabled={disabled}>
        <Plus className="size-5" />
      </button>
      <textarea
        ref={textareaRef}
        value={internalValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 resize-none overflow-hidden bg-transparent text-sm outline-none"
        rows={1}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !internalValue.trim()}
        className="rounded-lg p-2 text-[var(--c-text-secondary)] hover:text-[var(--c-accent)] disabled:opacity-50"
      >
        <Send className="size-5" />
      </button>
    </div>
  );
}