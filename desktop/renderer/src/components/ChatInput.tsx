import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Plus, X } from 'lucide-react';
import { api } from '../api';

interface AttachedFile {
  filePath: string;
  name: string;
}

interface ChatInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit: (text: string, files: AttachedFile[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSubmit, placeholder = 'Type a message...', disabled }: ChatInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? '');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (value !== undefined) setInternalValue(value);
  }, [value]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [internalValue]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setInternalValue(v);
    onChange?.(v);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    if (internalValue.trim()) {
      onSubmit(internalValue.trim(), files);
      setInternalValue('');
      onChange?.('');
      setFiles([]);
    }
  };

  const handleAttach = async () => {
    try {
      const { filePaths } = await api.selectMaterials();
      const newFiles = filePaths.map(p => ({
        filePath: p,
        name: p.split('/').pop() || p,
      }));
      setFiles(prev => [...prev, ...newFiles]);
    } catch {
      // User cancelled or not available
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="w-full">
      <div className="flex items-end gap-2 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3">
        <button
          type="button"
          onClick={handleAttach}
          className="p-1 text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]"
          disabled={disabled}
        >
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
          onClick={submit}
          disabled={disabled || !internalValue.trim()}
          className="rounded-lg p-2 text-[var(--c-text-secondary)] hover:text-[var(--c-accent)] disabled:opacity-50"
        >
          <Send className="size-5" />
        </button>
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={i}
              className="flex items-center gap-1 rounded-md bg-[var(--c-bg-sidebar)] px-2 py-0.5 text-xs"
            >
              <span className="max-w-[120px] truncate">{f.name}</span>
              <button type="button" onClick={() => removeFile(i)} className="text-[var(--c-text-secondary)] hover:text-red-500">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
