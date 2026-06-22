import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Trash2, FileText, Globe, ClipboardPaste, Search, BookOpen, Link, AlertCircle, ChevronRight } from 'lucide-react';
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

interface KbSearchResult {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  text: string;
  pageIndex: number | null;
  fusedScore: number;
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
  const [addMode, setAddMode] = useState<'paste' | 'url'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [privacyDismissed, setPrivacyDismissed] = useState(() => localStorage.getItem('kb-privacy-dismissed') === '1');

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
      setSearchResults([]);
      setSearchQuery('');
    } else if (collections.length > 0) {
      navigate(`/knowledge/${collections[0].id}`, { replace: true });
    } else {
      setSources([]);
    }
  }, [collectionId, collections, loadSources, navigate]);

  const handleCreateCollection = async () => {
    if (!desktop?.kbCreateCollection || !newCollectionName.trim()) return;
    try {
      const col = await desktop.kbCreateCollection({
        name: newCollectionName.trim(),
        embeddingModelId: 'bge-small-zh-v1.5',
        embeddingDim: 512,
      }) as KbCollection;
      setNewCollectionName('');
      setShowCreateDialog(false);
      await loadCollections();
      navigate(`/knowledge/${col.id}`);
    } catch { /* ignore */ }
  };

  const handleDeleteCollection = async (id: string) => {
    if (!desktop?.kbDeleteCollection) return;
    if (!confirm(t.knowledge.deleteCollectionConfirm)) return;
    try {
      await desktop.kbDeleteCollection(id);
      if (collectionId === id) navigate('/knowledge');
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleAddPasteSource = async () => {
    if (!desktop?.kbAddSource || !collectionId || !pasteText.trim()) return;
    try {
      await desktop.kbAddSource({
        collectionId,
        kind: 'paste',
        title: pasteTitle.trim() || t.knowledge.defaultPasteTitle,
        text: pasteText,
      });
      setPasteText('');
      setPasteTitle('');
      setShowAddSource(false);
      await loadSources(collectionId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleAddUrlSource = async () => {
    if (!desktop?.kbAddSource || !collectionId || !urlInput.trim()) return;
    try {
      await desktop.kbAddSource({
        collectionId,
        kind: 'url',
        title: urlTitle.trim() || urlInput.trim(),
        uri: urlInput.trim(),
      });
      setUrlInput('');
      setUrlTitle('');
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

  const handlePickFiles = async () => {
    if (!desktop?.kbPickFiles || !desktop?.kbAddSource || !collectionId) return;
    try {
      const filePaths = await desktop.kbPickFiles();
      for (const fp of filePaths) {
        const name = fp.split('/').pop() || fp.split('\\').pop() || 'file';
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html', json: 'application/json', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
        await desktop.kbAddSource({
          collectionId,
          kind: 'file',
          title: name,
          filePath: fp,
          mimeType: mimeMap[ext] || 'application/octet-stream',
        });
      }
      if (filePaths.length > 0) {
        await loadSources(collectionId);
        await loadCollections();
      }
    } catch { /* ignore */ }
  };

  const handleSearch = async () => {
    if (!desktop?.kbSearch || !collectionId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await desktop.kbSearch({ collectionId, query: searchQuery.trim(), topK: 20 });
      setSearchResults(results as KbSearchResult[]);
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!desktop?.kbAddSource || !collectionId) return;
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = (file as any).path as string | undefined;
      if (filePath) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html', json: 'application/json', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
        await desktop.kbAddSource({
          collectionId,
          kind: 'file',
          title: file.name,
          filePath,
          mimeType: mimeMap[ext] || file.type || 'application/octet-stream',
        });
      } else {
        const text = await file.text();
        await desktop.kbAddSource({
          collectionId,
          kind: 'paste',
          title: file.name,
          text,
        });
      }
    }
    await loadSources(collectionId);
    await loadCollections();
  };

  const selectedCollection = collections.find(c => c.id === collectionId);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.loading}</p>
      </div>
    );
  }

  // Empty state — no collections at all
  if (collections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <BookOpen size={48} className="text-[var(--c-text-tertiary)]" />
        <div className="text-center">
          <h2 className="text-xl font-medium text-[var(--c-text-primary)]">{t.knowledge.emptyTitle}</h2>
          <p className="mt-2 text-sm text-[var(--c-text-secondary)]">{t.knowledge.emptyDesc}</p>
          <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">{t.knowledge.emptyPrivacy}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateDialog(true)}
          className="rounded-lg bg-[var(--c-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--c-accent-send-hover)]"
        >
          {t.knowledge.createFirstCollection}
        </button>
        {showCreateDialog && <CreateCollectionDialog name={newCollectionName} setName={setNewCollectionName} onCreate={handleCreateCollection} onCancel={() => setShowCreateDialog(false)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--c-bg-page)]">
      {/* Header */}
      <header className="border-b border-[var(--c-border)] px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[var(--c-text-primary)]">{t.knowledge.pageTitle}</h1>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-1.5 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)]"
          >
            <Plus size={14} /> {t.knowledge.newCollection}
          </button>
        </div>
      </header>

      {/* Privacy notice */}
      {!privacyDismissed && (
        <div className="mx-6 mt-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 text-base">🔒</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-blue-800">
              {t.knowledge.privacyNotice}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { localStorage.setItem('kb-privacy-dismissed', '1'); setPrivacyDismissed(true); }}
            className="shrink-0 rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            {t.knowledge.privacyDismiss}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left: Collection list */}
        <nav className="w-56 shrink-0 overflow-y-auto border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)] p-3">
          {collections.map(col => (
            <div
              key={col.id}
              role="button"
              tabIndex={0}
              className={`group mb-1 flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                collectionId === col.id
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)]'
                  : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
              onClick={() => navigate(`/knowledge/${col.id}`)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/knowledge/${col.id}`); } }}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{col.name}</div>
                <div className="text-xs text-[var(--c-text-tertiary)]">{t.knowledge.chunkCount(col.chunkCountCached)}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleDeleteCollection(col.id); }}
                className="invisible text-[var(--c-text-tertiary)] transition-colors hover:text-red-500 group-hover:visible"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </nav>

        {/* Right: Collection detail */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
          {!selectedCollection ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--c-text-tertiary)]">
              <BookOpen size={32} />
              <p className="text-sm">{t.knowledge.selectCollection}</p>
            </div>
          ) : (
            <>
              {/* Collection header */}
              <div className="mb-4">
                <h2 className="text-lg font-medium text-[var(--c-text-primary)]">{selectedCollection.name}</h2>
                {selectedCollection.description && (
                  <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{selectedCollection.description}</p>
                )}
              </div>

              {/* Search */}
              <div className="mb-4 flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-text-tertiary)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleSearch(); }}
                    placeholder={t.knowledge.searchPlaceholder}
                    aria-label={t.knowledge.searchPlaceholder}
                    className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] py-1.5 pl-9 pr-3 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]"
                  />
                </div>
                <button type="button" onClick={() => void handleSearch()} disabled={searching} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[var(--c-accent-send-hover)] disabled:opacity-50">
                  {searching ? t.knowledge.searching : t.knowledge.searchBtn}
                </button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mb-4 rounded-lg border border-[var(--c-accent)]/20 bg-[var(--c-accent)]/5 p-3">
                  <h3 className="mb-2 text-xs font-medium text-[var(--c-accent)]">{t.knowledge.searchResultsTitle(searchResults.length)}</h3>
                  <div className="space-y-2">
                    {searchResults.slice(0, 10).map(r => (
                      <div key={r.chunkId} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] p-2">
                        <div className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
                          <span className="font-medium">{r.sourceTitle}</span>
                          {r.pageIndex != null && <span>· {t.knowledge.pageLabel(r.pageIndex + 1)}</span>}
                          <span className="ml-auto text-[var(--c-text-tertiary)]">score: {r.fusedScore.toFixed(2)}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--c-text-primary)] line-clamp-3">{r.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add source area */}
              <div
                className={`mb-4 rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
                  dragOver ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/5' : 'border-[var(--c-border)]'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => void handleDrop(e)}
              >
                {dragOver ? (
                  <p className="text-sm text-[var(--c-accent)]">{t.knowledge.dropToAdd}</p>
                ) : (
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button type="button" onClick={() => void handlePickFiles()} className="flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                      <FileText size={12} /> {t.knowledge.pickFiles}
                    </button>
                    <button type="button" onClick={() => { setAddMode('paste'); setShowAddSource(true); }} className="flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                      <ClipboardPaste size={12} /> {t.knowledge.pasteText}
                    </button>
                    <button type="button" onClick={() => { setAddMode('url'); setShowAddSource(true); }} className="flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                      <Link size={12} /> {t.knowledge.addUrl}
                    </button>
                    <span className="text-xs text-[var(--c-text-tertiary)]">{t.knowledge.orDragFiles}</span>
                  </div>
                )}
              </div>

              {/* Add source dialog */}
              {showAddSource && (
                <div className="mb-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
                  {addMode === 'paste' ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={pasteTitle}
                        onChange={e => setPasteTitle(e.target.value)}
                        placeholder={t.knowledge.titleOptional}
                        aria-label={t.knowledge.titleOptional}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <textarea
                        value={pasteText}
                        onChange={e => setPasteText(e.target.value)}
                        placeholder={t.knowledge.pasteContentPlaceholder}
                        aria-label={t.knowledge.pasteContentPlaceholder}
                        rows={5}
                        className="w-full resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setShowAddSource(false)} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm">{t.knowledge.cancel}</button>
                        <button type="button" onClick={() => void handleAddPasteSource()} disabled={!pasteText.trim()} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{t.knowledge.addSource}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={urlTitle}
                        onChange={e => setUrlTitle(e.target.value)}
                        placeholder={t.knowledge.titleOptional}
                        aria-label={t.knowledge.titleOptional}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <input
                        type="url"
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://..."
                        aria-label="URL"
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setShowAddSource(false)} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm">{t.knowledge.cancel}</button>
                        <button type="button" onClick={() => void handleAddUrlSource()} disabled={!urlInput.trim()} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{t.knowledge.addUrlBtn}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Source list */}
              {sources.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--c-text-tertiary)]">
                  <FileText size={24} />
                  <p className="text-sm">{t.knowledge.emptyCollection}</p>
                  <p className="text-xs">{t.knowledge.emptyCollectionHint}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {sources.map(src => (
                    <div key={src.id} className="group flex items-center gap-3 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2.5">
                      <SourceKindIcon kind={src.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--c-text-primary)]">{src.title}</div>
                        <div className="flex items-center gap-2 text-xs text-[var(--c-text-tertiary)]">
                          <span>{t.knowledge.chunkCount(src.chunkCount)}</span>
                          <StatusBadge status={src.parseStatus} />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSource(src.id)}
                        className="invisible text-[var(--c-text-tertiary)] transition-colors hover:text-red-500 group-hover:visible"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Create collection dialog */}
      {showCreateDialog && (
        <CreateCollectionDialog
          name={newCollectionName}
          setName={setNewCollectionName}
          onCreate={handleCreateCollection}
          onCancel={() => setShowCreateDialog(false)}
        />
      )}
    </div>
  );
}

function SourceKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'url': return <Globe size={16} className="shrink-0 text-blue-500" />;
    case 'paste': return <ClipboardPaste size={16} className="shrink-0 text-green-600" />;
    default: return <FileText size={16} className="shrink-0 text-[var(--c-text-icon)]" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  switch (status) {
    case 'parsed': return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">{t.knowledge.statusParsed}</span>;
    case 'pending': return <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-700">{t.knowledge.statusPending}</span>;
    case 'parsing': return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{t.knowledge.statusParsing}</span>;
    case 'failed': return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">{t.knowledge.statusFailed}</span>;
    default: return null;
  }
}

function CreateCollectionDialog({ name, setName, onCreate, onCancel }: {
  name: string;
  setName: (v: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="w-80 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-5 shadow-lg" onClick={e => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.createCollectionTitle}</h3>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCreate(); }}
          placeholder={t.knowledge.collectionNamePlaceholder}
          aria-label={t.knowledge.collectionNamePlaceholder}
          className="mb-4 w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)]">{t.knowledge.cancel}</button>
          <button type="button" onClick={onCreate} disabled={!name.trim()} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{t.knowledge.createBtn}</button>
        </div>
      </div>
    </div>
  );
}
