import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Trash2, FileText, Globe, ClipboardPaste, Search, BookOpen, Database } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';

interface KbCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  chunkCountCached: number;
  createdAt: number;
  updatedAt: number;
}

interface KbSource {
  id: string;
  collectionId: string;
  kind: 'file' | 'url' | 'paste';
  title: string;
  uri: string;
  parseStatus: string;
  chunkCount: number;
  createdAt: number;
}

export function KnowledgePage() {
  const { collectionId } = useParams<{ collectionId?: string }>();
  const navigate = useNavigate();
  const { t } = useLocale();

  const [collections, setCollections] = useState<KbCollection[]>([]);
  const [sources, setSources] = useState<KbSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');

  const desktop = getDesktopApi();

  const loadCollections = useCallback(async () => {
    if (!desktop?.kbListCollections) return;
    try {
      const result = await desktop.kbListCollections();
      setCollections(result as KbCollection[]);
    } catch { /* ignore */ }
  }, [desktop]);

  const loadSources = useCallback(async (cid: string) => {
    if (!desktop?.kbListSources) return;
    try {
      const result = await desktop.kbListSources(cid);
      setSources(result as KbSource[]);
    } catch { /* ignore */ }
  }, [desktop]);

  useEffect(() => {
    setLoading(true);
    void loadCollections().then(() => setLoading(false));
  }, [loadCollections]);

  useEffect(() => {
    if (collectionId) {
      void loadSources(collectionId);
    } else {
      setSources([]);
    }
  }, [collectionId, loadSources]);

  const handleCreateCollection = async () => {
    if (!desktop?.kbCreateCollection || !newCollectionName.trim()) return;
    try {
      await desktop.kbCreateCollection({
        name: newCollectionName.trim(),
        embeddingModelId: 'default',
        embeddingDim: 384,
      });
      setNewCollectionName('');
      setShowCreateDialog(false);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleDeleteCollection = async (id: string) => {
    if (!desktop?.kbDeleteCollection) return;
    try {
      await desktop.kbDeleteCollection(id);
      if (collectionId === id) {
        navigate('/knowledge');
      }
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleAddPasteSource = async () => {
    if (!desktop?.kbAddSource || !collectionId || !pasteText.trim()) return;
    try {
      await desktop.kbAddSource({
        collectionId,
        kind: 'paste',
        title: pasteTitle.trim() || 'Pasted text',
        text: pasteText,
      });
      setPasteText('');
      setPasteTitle('');
      setShowAddSource(false);
      await loadSources(collectionId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleDeleteSource = async (id: string) => {
    if (!desktop?.kbDeleteSource || !collectionId) return;
    try {
      await desktop.kbDeleteSource(id);
      await loadSources(collectionId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const selectedCollection = collections.find(c => c.id === collectionId);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--c-text-secondary)]">{t.commonLoading}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel - Collection list */}
      <div className="flex w-64 flex-col border-r border-[var(--c-border)] bg-[var(--c-bg-page)]">
        <div className="flex items-center justify-between border-b border-[var(--c-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--c-text-heading)]">
            {t.sidebarKnowledge}
          </h2>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="flex size-7 items-center justify-center rounded-md text-[var(--c-text-icon)] transition-colors hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
            title="New collection"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {collections.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <Database size={32} className="mb-3 text-[var(--c-text-tertiary)]" />
              <p className="text-xs text-[var(--c-text-secondary)]">
                No collections yet
              </p>
              <button
                type="button"
                onClick={() => setShowCreateDialog(true)}
                className="mt-3 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                Create collection
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {collections.map(col => (
                <div
                  key={col.id}
                  className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    col.id === collectionId
                      ? 'bg-[var(--c-bg-deep)] text-[var(--c-text-primary)]'
                      : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-card)]'
                  }`}
                  onClick={() => navigate(`/knowledge/${col.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter') navigate(`/knowledge/${col.id}`); }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <BookOpen size={14} className="shrink-0" />
                    <span className="truncate">{col.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-[var(--c-text-tertiary)]">
                      {col.chunkCountCached}
                    </span>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); void handleDeleteCollection(col.id); }}
                      className="hidden shrink-0 p-0.5 text-[var(--c-text-tertiary)] hover:text-red-500 group-hover:block"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Sources in selected collection */}
      <div className="flex flex-1 flex-col bg-[var(--c-bg-page)]">
        {!selectedCollection ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <BookOpen size={48} className="mb-4 text-[var(--c-text-tertiary)]" />
            <h3 className="mb-2 text-lg font-semibold text-[var(--c-text-heading)]">
              {t.sidebarKnowledge}
            </h3>
            <p className="max-w-sm text-sm text-[var(--c-text-secondary)]">
              Select a collection from the left panel or create a new one to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--c-border)] px-6 py-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--c-text-heading)]">
                  {selectedCollection.name}
                </h2>
                {selectedCollection.description && (
                  <p className="text-xs text-[var(--c-text-secondary)]">
                    {selectedCollection.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAddSource(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                <Plus size={14} />
                Add source
              </button>
            </div>

            {/* Source list */}
            <div className="flex-1 overflow-y-auto p-6">
              {sources.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileText size={32} className="mb-3 text-[var(--c-text-tertiary)]" />
                  <p className="mb-1 text-sm font-medium text-[var(--c-text-secondary)]">
                    No sources yet
                  </p>
                  <p className="text-xs text-[var(--c-text-tertiary)]">
                    Add files, URLs, or paste text to build this knowledge base.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {sources.map(src => (
                    <div
                      key={src.id}
                      className="group flex items-center justify-between rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <SourceKindIcon kind={src.kind} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--c-text-primary)]">
                            {src.title}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-[var(--c-text-tertiary)]">
                            <span>{src.kind}</span>
                            <span className="size-0.5 rounded-full bg-[var(--c-text-tertiary)]" />
                            <span>{src.chunkCount} chunks</span>
                            <span className="size-0.5 rounded-full bg-[var(--c-text-tertiary)]" />
                            <SourceStatusBadge status={src.parseStatus} />
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSource(src.id)}
                        className="hidden shrink-0 p-1 text-[var(--c-text-tertiary)] hover:text-red-500 group-hover:block"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create collection dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-page)] p-6 shadow-xl">
            <h3 className="mb-4 text-base font-semibold text-[var(--c-text-heading)]">
              Create collection
            </h3>
            <input
              type="text"
              value={newCollectionName}
              onChange={e => setNewCollectionName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateCollection(); }}
              placeholder="Collection name..."
              className="mb-4 w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowCreateDialog(false); setNewCollectionName(''); }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                {t.commonCancel}
              </button>
              <button
                type="button"
                onClick={() => void handleCreateCollection()}
                disabled={!newCollectionName.trim()}
                className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add source dialog */}
      {showAddSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-page)] p-6 shadow-xl">
            <h3 className="mb-4 text-base font-semibold text-[var(--c-text-heading)]">
              Add source
            </h3>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-[var(--c-text-secondary)]">
                Title
              </label>
              <input
                type="text"
                value={pasteTitle}
                onChange={e => setPasteTitle(e.target.value)}
                placeholder="Source title..."
                className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
              />
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-[var(--c-text-secondary)]">
                Content
              </label>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder="Paste text content here..."
                rows={8}
                className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowAddSource(false); setPasteText(''); setPasteTitle(''); }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                {t.commonCancel}
              </button>
              <button
                type="button"
                onClick={() => void handleAddPasteSource()}
                disabled={!pasteText.trim()}
                className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'file':
      return <FileText size={16} className="shrink-0 text-[var(--c-text-tertiary)]" />;
    case 'url':
      return <Globe size={16} className="shrink-0 text-[var(--c-text-tertiary)]" />;
    case 'paste':
      return <ClipboardPaste size={16} className="shrink-0 text-[var(--c-text-tertiary)]" />;
    default:
      return <FileText size={16} className="shrink-0 text-[var(--c-text-tertiary)]" />;
  }
}

function SourceStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    parsed: 'text-green-600',
    parsing: 'text-yellow-600',
    pending: 'text-[var(--c-text-tertiary)]',
    failed: 'text-red-500',
    unsupported: 'text-orange-500',
  };
  return (
    <span className={`font-medium ${colors[status] ?? 'text-[var(--c-text-tertiary)]'}`}>
      {status}
    </span>
  );
}
