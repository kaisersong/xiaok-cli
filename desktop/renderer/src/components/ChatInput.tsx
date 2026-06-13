import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Send, Square, X, Plus } from 'lucide-react';
import { api } from '../api';

interface AttachedFile {
  filePath: string;
  name: string;
  isImage?: boolean;
}

interface SkillItem {
  name: string;
  aliases: string[];
  description: string;
  source: string;
  tier: string;
}

interface ChatInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit: (text: string, files: AttachedFile[]) => void;
  onQueue?: (text: string) => void;
  queuedText?: string | null;
  onCancelQueue?: () => void;
  placeholder?: string;
  disabled?: boolean;
  isRunning?: boolean;
  onStop?: () => void;
}

const TEXTAREA_MAX_HEIGHT = 220;

export function ChatInput({ value, onChange, onSubmit, onQueue, queuedText, onCancelQueue, placeholder = '回复...', disabled, isRunning, onStop }: ChatInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? '');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [focused, setFocused] = useState(false);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const pastePathsRef = useRef<string[] | null>(null);
  const pasteHandlerRef = useRef<((e: ClipboardEvent) => void) | null>(null);

  const textareaCallbackRef = useCallback((el: HTMLTextAreaElement | null) => {
    // Remove old listener if element changes
    if (pasteHandlerRef.current && (textareaRef.current || el === null)) {
      (textareaRef.current ?? el)?.removeEventListener('paste', pasteHandlerRef.current);
    }
    (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    if (!el) return;

    const handler = (e: ClipboardEvent) => {
      const clipItems = Array.from(e.clipboardData?.items ?? []);

      // File path paste takes priority over image paste.
      // Copying a file in Finder puts both the file path (text/plain) and an
      // image preview (image/tiff) on the clipboard; we must check paths first
      // so we don't mistake a copied image file for a screenshot paste.
      const plainText = e.clipboardData?.getData('text/plain') ?? '';
      const lines = plainText.split(/\r?\n/).flatMap(l => { const t = l.trim(); return t ? [t] : []; });
      const pathLines = lines.filter(l => l.startsWith('/'));
      if (pathLines.length > 0) {
        pastePathsRef.current = pathLines;
        return;
      }

      // Image paste (screenshot / raw image data, no file path)
      const hasImage = clipItems.some(item => item.type.startsWith('image/'));
      if (hasImage && window.xiaokDesktop?.readClipboardImage) {
        e.preventDefault();
        window.xiaokDesktop.readClipboardImage().then(imagePath => {
          if (imagePath) {
            const name = imagePath.split('/').pop() || 'clipboard-image.png';
            setFiles(prev => [...prev, { filePath: imagePath, name, isImage: true }]);
          }
        }).catch(() => {});
        return;
      }

      // Finder NSFilenamesPboardType — clipboard has file items but no text path.
      // DataTransferItem.kind === 'file' is detectable synchronously, so we can
      // call preventDefault() before going async to fetch the real paths via IPC.
      const hasFileItems = clipItems.some(item => item.kind === 'file');
      if (hasFileItems && window.xiaokDesktop?.readClipboardFilePaths) {
        e.preventDefault();
        window.xiaokDesktop.readClipboardFilePaths().then(fp => {
          if (fp.length > 0) {
            const newFiles = fp.map(p => {
              const name = p.split('/').pop() || p;
              const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
              return { filePath: p, name, isImage };
            });
            setFiles(prev => [...prev, ...newFiles]);
          }
        }).catch(() => {});
      }
    };
    pasteHandlerRef.current = handler;
    el.addEventListener('paste', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.listSkills().then(list => setSkills(list)).catch(() => {});
  }, []);

  useEffect(() => {
    if (value !== undefined) setInternalValue(value);
  }, [value]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
    }
  }, [internalValue]);

  // Show slash menu when input starts with /
  useEffect(() => {
    if (internalValue.startsWith('/')) {
      const query = internalValue.slice(1).toLowerCase();
      setSlashQuery(query);
      setShowSlashMenu(true);
      setSelectedIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  }, [internalValue]);

  const matchedSkills = skills.filter(s =>
    s.name.toLowerCase().includes(slashQuery) ||
    s.aliases.some(a => a.toLowerCase().includes(slashQuery))
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    // If paste detected file paths, strip them from the textarea and add as chips
    if (pastePathsRef.current) {
      const paths = pastePathsRef.current;
      pastePathsRef.current = null;
      // Strip the pasted path text from the new value
      let stripped = v;
      for (const p of paths) stripped = stripped.replace(p, '');
      stripped = stripped.replace(/\n+/g, '\n').trimEnd();
      const newFiles = paths.map(p => {
        const name = p.split('/').pop() || p;
        const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
        return { filePath: p, name, isImage };
      });
      setFiles(prev => [...prev, ...newFiles]);
      setInternalValue(stripped);
      onChange?.(stripped);
      // Try NSFilenamesPboardType to get canonical paths
      if (window.xiaokDesktop?.readClipboardFilePaths) {
        window.xiaokDesktop.readClipboardFilePaths().then(fp => {
          if (fp.length > 0) {
            setFiles(prev => {
              const base = prev.slice(0, prev.length - paths.length);
              return [...base, ...fp.map(p => {
                const name = p.split('/').pop() || p;
                const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
                return { filePath: p, name, isImage };
              })];
            });
          }
        }).catch(() => {});
      }
      return;
    }
    setInternalValue(v);
    onChange?.(v);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Intercept Cmd+V to catch Finder file copies where clipboard has no text/plain path.
    // readClipboardFilePaths reads NSFilenamesPboardType which Finder always populates.
    // We must call preventDefault() synchronously here before the paste runs.
    if (e.key === 'v' && e.metaKey && !e.shiftKey && !e.altKey && window.xiaokDesktop?.readClipboardFilePaths) {
      // Snapshot value before paste lands so we can restore it if files are found.
      const valueBeforePaste = internalValue;
      window.xiaokDesktop.readClipboardFilePaths().then(fp => {
        if (fp.length > 0) {
          const newFiles = fp.map(p => {
            const name = p.split('/').pop() || p;
            const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
            return { filePath: p, name, isImage };
          });
          setFiles(prev => [...prev, ...newFiles]);
          // Restore pre-paste value — Finder pastes file name as text which we don't want
          setInternalValue(valueBeforePaste);
          onChange?.(valueBeforePaste);
        }
      }).catch(() => {});
      // Don't preventDefault here — if there are no file paths, normal text paste should proceed.
      // The paste event handler will fire afterward and handle text/image cases.
    }
    if (showSlashMenu && matchedSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, matchedSkills.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        selectSkill(matchedSkills[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (isRunning && onQueue && internalValue.trim()) {
        onQueue(internalValue.trim());
        setInternalValue('');
        onChange?.('');
        return;
      }
      // Allow submit with text OR files
      if (internalValue.trim() || files.length > 0) {
        submit();
      }
    }
  };

  const selectSkill = (skill: SkillItem) => {
    const newValue = `/${skill.name} `;
    setInternalValue(newValue);
    onChange?.(newValue);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const submit = () => {
    const hasText = internalValue.trim();
    const hasFiles = files.length > 0;
    if (hasText || hasFiles) {
      onSubmit(internalValue.trim() || '请处理这些文件', files);
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
        const newFiles = result.filePaths.map(path => {
          const name = path.split('/').pop() || path;
          const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
          return { filePath: path, name, isImage };
        });
        setFiles(prev => [...prev, ...newFiles]);
      }
    } catch (e) {
      console.error('[ChatInput] selectMaterials error:', e);
    }
  };

  return (
    <div className="w-full relative">
      {/* Slash command menu */}
      {showSlashMenu && matchedSkills.length > 0 && (
        <div
          ref={slashMenuRef}
          className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-lg overflow-hidden z-50"
          style={{ maxWidth: '100%' }}
        >
          <div className="p-2 text-xs text-[var(--c-text-secondary)] border-b border-[var(--c-border)]">
            技能命令 (↑↓选择, Tab确认)
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {matchedSkills.map((skill, i) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => selectSkill(skill)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                  i === selectedIndex ? 'bg-[var(--c-accent)]/10' : 'hover:bg-[var(--c-bg-deep)]'
                }`}
              >
                <span className="text-[var(--c-accent)] font-mono shrink-0">/{skill.name}</span>
                <span className="text-[var(--c-text-secondary)] truncate">{skill.description?.slice(0, 50) || ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Attachment grid */}
      {files.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '12px 16px 8px',
          }}
        >
          {files.map((f, i) => (
            f.isImage ? (
              <div
                key={i}
                style={{ position: 'relative', display: 'inline-block' }}
              >
                <img
                  src={`file://${f.filePath}`}
                  alt={f.name}
                  title={f.filePath}
                  style={{
                    width: '64px',
                    height: '64px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    display: 'block',
                    border: '0.5px solid var(--c-border-subtle)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'var(--c-text-secondary)',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                >
                  <X size={10} style={{ color: '#fff' }} />
                </button>
              </div>
            ) : (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                style={{
                  background: 'var(--c-bg-deep)',
                  border: '0.5px solid var(--c-border-subtle)',
                  maxWidth: '280px',
                }}
              >
                <span className="text-sm text-[var(--c-text-primary)] truncate" title={f.filePath}>{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="flex items-center justify-center rounded-md hover:bg-[rgba(0,0,0,0.05)] flex-shrink-0"
                  style={{ width: '18px', height: '18px', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                >
                  <X size={12} style={{ color: 'var(--c-text-secondary)' }} />
                </button>
              </div>
            )
          ))}
        </div>
      )}

      {/* Queued message banner */}
      {queuedText && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2"
          style={{
            background: 'var(--c-bg-deep)',
            border: '0.5px solid var(--c-border-subtle)',
          }}
        >
          <span className="text-xs text-[var(--c-text-secondary)] shrink-0">队列中</span>
          <span className="text-sm text-[var(--c-text-primary)] truncate flex-1" title={queuedText}>{queuedText}</span>
          {onCancelQueue && (
            <button
              type="button"
              onClick={onCancelQueue}
              className="flex items-center justify-center rounded-md hover:bg-[rgba(0,0,0,0.05)]"
              style={{ width: '20px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <X size={14} style={{ color: 'var(--c-text-secondary)' }} />
            </button>
          )}
        </div>
      )}

      {/* Input container - pill shaped with shadow */}
      <div
        role="presentation"
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
        onKeyDown={(e) => { if (e.key === 'Enter') textareaRef.current?.focus(); }}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          style={{ padding: '10px 12px 8px' }}
        >
          {/* Textarea */}
          <div style={{ position: 'relative', marginBottom: '8px' }}>
            <textarea aria-label={placeholder}
              ref={textareaCallbackRef}
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
                maxHeight: `${TEXTAREA_MAX_HEIGHT}px`,
                overflowY: 'auto',
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
                className="flex size-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] transition-[opacity,background] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:opacity-100 opacity-70"
              >
                <Plus size={18} />
              </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }} />

            {isRunning ? (
              <button
                type="button"
                onClick={onStop}
                className="flex size-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] transition-[opacity,background] duration-[60ms] hover:bg-[var(--c-bg-deep)] hover:opacity-100 opacity-70"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled || (!internalValue.trim() && files.length === 0)}
                className="flex size-[33.5px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-accent-send)] text-[var(--c-accent-send-text)] transition-[background-color,opacity] duration-[60ms] hover:bg-[var(--c-accent-send-hover)] active:opacity-[0.75] active:scale-[0.93] disabled:cursor-not-allowed disabled:opacity-60"
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
