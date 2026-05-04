import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Square, X, Plus } from 'lucide-react';
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
  isRunning?: boolean;
  onStop?: () => void;
}

export function ChatInput({ value, onChange, onSubmit, placeholder = '回复...', disabled, isRunning, onStop }: ChatInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? '');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [focused, setFocused] = useState(false);
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

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAttach = async () => {
    try {
      const result = await api.selectMaterials();
      if (result.filePaths.length > 0) {
        const newFiles = result.filePaths.map(path => ({
          filePath: path,
          name: path.split('/').pop() || path,
        }));
        setFiles(prev => [...prev, ...newFiles]);
      }
    } catch (e) {
      console.error('[ChatInput] selectMaterials error:', e);
    }
  };

  return (
    <div className="w-full">
      {/* Attachment grid */}
      {files.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            padding: '14px 16px 8px',
          }}
        >
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{
                background: 'var(--c-bg-deep)',
                border: '0.5px solid var(--c-border-subtle)',
              }}
            >
              <span className="text-sm text-[var(--c-text-primary)] max-w-[120px] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="flex items-center justify-center rounded-md hover:bg-[rgba(0,0,0,0.05)]"
                style={{ width: '20px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
              >
                <X size={14} style={{ color: 'var(--c-text-secondary)' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input container - pill shaped with shadow */}
      <div
        className={[
          focused && 'is-focused',
        ].filter(Boolean).join(' ')}
        style={{
          borderWidth: '0.5px',
          borderStyle: 'solid',
          borderColor: focused ? 'var(--c-input-border-color-focus)' : 'var(--c-input-border-color)',
          borderRadius: '20px',
          boxShadow: focused ? 'var(--c-input-shadow-focus)' : 'var(--c-input-shadow)',
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          background: 'var(--c-bg-card)',
          cursor: 'default',
        }}
        onClick={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (tag !== 'BUTTON' && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SVG' && tag !== 'PATH') {
            textareaRef.current?.focus();
          }
        }}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          style={{ padding: '10px 12px 8px' }}
        >
          {/* Textarea */}
          <div style={{ position: 'relative', marginBottom: '8px' }}>
            <textarea
              ref={textareaRef}
              rows={1}
              className="w-full resize-none bg-transparent outline-none"
              value={internalValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={placeholder}
              disabled={disabled}
              style={{
                fontFamily: 'inherit',
                fontSize: '16px',
                fontWeight: 310,
                lineHeight: 1.45,
                color: 'var(--c-text-primary)',
                letterSpacing: '-0.16px',
              }}
            />
          </div>

          {/* Bottom row */}
          <div
            className="flex items-center"
            style={{ gap: '8px', minHeight: '32px', width: '100%', minWidth: 0 }}
          >
            {!isRunning && (
              <button
                type="button"
                onClick={handleAttach}
                className="flex h-[33.5px] w-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] transition-[opacity,background] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:opacity-100 opacity-70"
              >
                <Plus size={18} />
              </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }} />

            {isRunning ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-[33.5px] w-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] transition-[opacity,background] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:opacity-100 opacity-70"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled || !internalValue.trim()}
                className="flex h-[33.5px] w-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-accent-send)] text-[var(--c-accent-send-text)] transition-[background-color,opacity] duration-[60ms] hover:bg-[var(--c-accent-send-hover)] active:opacity-[0.75] active:scale-[0.93] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}