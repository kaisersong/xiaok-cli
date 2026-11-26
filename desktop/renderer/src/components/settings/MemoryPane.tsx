import { useState } from 'react';
import { Brain } from 'lucide-react';
import { LocalMemoryStatsCard } from './LocalMemoryStatsCard';
import { MemoryModelSettings } from './MemoryModelSettings';
import { MemoryCompactionModelSettings } from './MemoryCompactionModelSettings';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, btnSecondary } from './settings-ui';

// ---- Memory ----

export function MemoryPane({ onOpenDecisionModels }: { onOpenDecisionModels: () => void }) {
  const { t } = useLocale();
  const [memoryTab, setMemoryTab] = useState<'content' | 'configuration'>('content');
  const ds = t.desktopSettings;
  return (
    <Section>
      <SectionHeader icon={Brain}>{ds.memoryPaneTitle}</SectionHeader>
      <p className="text-xs text-[var(--c-text-secondary)] mb-4">{ds.memoryPaneDesc}</p>
      <div role="tablist" aria-label={ds.memoryPaneTitle} className="mb-5 flex gap-4 border-b border-[var(--c-border-subtle)]">
        {(['content', 'configuration'] as const).map(tab => (
          <button type="button" role="tab" key={tab} id={`memory-tab-${tab}`}
            aria-selected={memoryTab === tab} aria-controls={`memory-panel-${tab}`}
            tabIndex={memoryTab === tab ? 0 : -1}
            onClick={() => setMemoryTab(tab)}
            onKeyDown={event => {
              if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'content' : event.key === 'End' ? 'configuration' : memoryTab === 'content' ? 'configuration' : 'content';
              setMemoryTab(next);
              document.getElementById(`memory-tab-${next}`)?.focus();
            }}
            className={`border-b-2 px-1 py-2 text-sm ${memoryTab === tab ? 'border-[var(--c-accent)] text-[var(--c-text-heading)]' : 'border-transparent text-[var(--c-text-muted)]'}`}>
            {tab === 'content' ? ds.memoryContentTab : ds.memoryConfigurationTab}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="memory-panel-content" aria-labelledby="memory-tab-content" hidden={memoryTab !== 'content'}>
        <LocalMemoryStatsCard showModelConfig={false} />
      </div>
      {memoryTab === 'configuration' && <div role="tabpanel" id="memory-panel-configuration" aria-labelledby="memory-tab-configuration" className="space-y-6">
        <MemoryCompactionModelSettings />
        <MemoryModelSettings />
        <div className="rounded-xl border border-[var(--c-border)] p-4">
          <p className="mb-3 text-xs text-[var(--c-text-secondary)]">{ds.memoryDecisionModelsMoved}</p>
          <button type="button" className={btnSecondary} onClick={onOpenDecisionModels}>{ds.openDecisionModelSettings}</button>
        </div>
      </div>}
    </Section>
  );
}
