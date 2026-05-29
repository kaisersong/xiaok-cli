/**
 * ImportMemoryModal — import Memory entries as project principles.
 */

import { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';

interface MemoryEntry {
  id: string;
  content: string;
  createdAt?: string;
}

interface Props {
  open: boolean;
  onClose(): void;
  onImport(entries: MemoryEntry[]): Promise<void>;
}

export function ImportMemoryModal({ open, onClose, onImport }: Props) {
  const { t } = useLocale();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSearch('');
    loadMemories();
  }, [open]);

  const loadMemories = async () => {
    setLoading(true);
    try {
      const api = getDesktopApi() as any;
      if (!api?.listMemories) return;
      const list = await api.listMemories();
      setMemories(Array.isArray(list) ? list : []);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = memories.filter(m =>
    !search || m.content.toLowerCase().includes(search.toLowerCase())
  );

  const toggleItem = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    const entries = memories.filter(m => selected.has(m.id));
    if (entries.length === 0) return;
    setImporting(true);
    try {
      await onImport(entries);
      onClose();
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] shadow-xl"
        style={{ maxHeight: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--c-border-subtle)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--c-text-primary)]">
            {t.projectsPrinciplesImportTitle}
          </h3>
          <button type="button" aria-label="Close import modal" onClick={onClose} className="rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--c-border-subtle)] px-5 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--c-text-muted)]" />
            <input aria-label={t.projectsPrinciplesImportSearch}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t.projectsPrinciplesImportSearch}
              className="w-full rounded-md border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] py-1.5 pl-8 pr-3 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--c-accent)]"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-center text-xs text-[var(--c-text-muted)]">...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-xs text-[var(--c-text-muted)]">{t.projectsPrinciplesImportEmpty}</p>
          ) : (
            <div className="space-y-2">
              {filtered.map(m => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
                    selected.has(m.id)
                      ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/5'
                      : 'border-[var(--c-border-subtle)] hover:bg-[var(--c-bg-deep)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggleItem(m.id)}
                    className="mt-0.5 size-3.5 rounded border-[var(--c-border-subtle)] accent-[var(--c-accent)]"
                  />
                  <span className="text-xs leading-relaxed text-[var(--c-text-secondary)]">{m.content}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--c-border-subtle)] px-5 py-3">
          <span className="text-[10px] text-[var(--c-text-muted)]">
            {selected.size > 0 && `${selected.size} selected`}
          </span>
          <button
            type="button"
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
            className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] disabled:opacity-50 disabled:pointer-events-none"
          >
            {importing ? '...' : t.projectsPrinciplesImportBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
