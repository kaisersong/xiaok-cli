import { useEffect, useState } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import { api } from '../api';

interface MemoryEntryView {
  id: string;
  content: string;
  tags?: string[];
  createdAt?: number | string;
  source?: string;
}

function formatCreatedAt(value: number | string | undefined): string {
  if (typeof value === 'number') {
    return new Date(value).toLocaleString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }
  return '';
}

export function LocalMemoryStats() {
  const [entries, setEntries] = useState<MemoryEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listMemories();
      setEntries(Array.isArray(result) ? result as MemoryEntryView[] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, []);

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'var(--c-border)',
        background: 'var(--c-bg-soft)',
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'var(--c-bg-elevated)' }}
          >
            <Brain size={18} />
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--c-text-primary)]">Notebook</div>
            <div className="text-xs text-[var(--c-text-secondary)]">
              {loading ? '正在加载记忆…' : `当前共有 ${entries.length} 条长期记忆`}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadEntries()}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs transition-colors"
          style={{
            border: '1px solid var(--c-border)',
            background: 'var(--c-bg-elevated)',
            color: 'var(--c-text-secondary)',
          }}
        >
          <RefreshCw size={12} />
          刷新
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          读取记忆失败：{error}
        </div>
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-[var(--c-text-secondary)]">
          还没有长期记忆。对话里让 xiaok “记住”某些信息后，这里会显示出来。
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.slice(0, 8).map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border px-3 py-2"
              style={{
                borderColor: 'var(--c-border-subtle)',
                background: 'var(--c-bg-elevated)',
              }}
            >
              <div className="mb-1 text-sm text-[var(--c-text-primary)]">{entry.content}</div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--c-text-secondary)]">
                {entry.tags && entry.tags.length > 0 ? (
                  <span>{entry.tags.join(' / ')}</span>
                ) : null}
                {entry.source ? <span>来源：{entry.source}</span> : null}
                {formatCreatedAt(entry.createdAt) ? <span>{formatCreatedAt(entry.createdAt)}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
