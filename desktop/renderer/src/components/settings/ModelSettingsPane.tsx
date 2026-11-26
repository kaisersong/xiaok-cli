import { DecisionModelSettings } from './DecisionModelSettings';
import { KimDecisionSection } from '../KimDecisionSection';
import { useState, useEffect, useRef } from 'react';
import { useLocale } from '../../contexts/LocaleContext';
import { ConversationModelPane } from './ConversationModelPane';
import { SystemOneSection } from './SystemOneSection';

export type ModelSettingsTab = 'conversation' | 'decision';

export function ModelSettingsPane({ activeTab, onSelect }: { activeTab: ModelSettingsTab; onSelect: (tab: ModelSettingsTab) => void }) {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const [visited, setVisited] = useState<ModelSettingsTab[]>(() => [activeTab]);
  const initialTab = useRef(activeTab);
  const buttons = useRef<Partial<Record<ModelSettingsTab, HTMLButtonElement | null>>>({});
  const tabs = ['conversation', 'decision'] as const;
  useEffect(() => {
    if (initialTab.current === 'decision') buttons.current.decision?.focus();
  }, []);
  const select = (tab: ModelSettingsTab) => {
    setVisited(current => current.includes(tab) ? current : [...current, tab]);
    onSelect(tab);
  };
  return <>
    <div role="tablist" aria-label={ds.navModel} className="mb-5 flex flex-wrap gap-4 border-b border-[var(--c-border-subtle)]">
      {tabs.map((tab, index) => <button key={tab} type="button" role="tab" id={`model-tab-${tab}`}
        ref={node => { buttons.current[tab] = node; }}
        aria-selected={activeTab === tab} aria-controls={`model-panel-${tab}`} tabIndex={activeTab === tab ? 0 : -1}
        onClick={() => select(tab)}
        onKeyDown={event => {
          const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1]
            : event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
            : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : undefined;
          if (!next) return;
          event.preventDefault(); select(next); buttons.current[next]?.focus();
        }}
        className={`border-b-2 px-1 py-2 text-sm ${activeTab === tab ? 'border-[var(--c-accent)] text-[var(--c-text-heading)]' : 'border-transparent text-[var(--c-text-muted)]'}`}>
        {tab === 'conversation' ? ds.conversationModelsTab : ds.decisionModelsTab}
      </button>)}
    </div>
    <div role="tabpanel" id="model-panel-conversation" aria-labelledby="model-tab-conversation" hidden={activeTab !== 'conversation'}>
      {(visited.includes('conversation') || activeTab === 'conversation') && <ConversationModelPane />}
    </div>
    <div role="tabpanel" id="model-panel-decision" aria-labelledby="model-tab-decision" hidden={activeTab !== 'decision'}>
      {(visited.includes('decision') || activeTab === 'decision') && <>
        <p className="mb-5 text-xs text-[var(--c-text-secondary)]">{ds.decisionModelsDesc}</p>
        <SystemOneSection />
        <KimDecisionSection />
        <DecisionModelSettings />
      </>}
    </div>
  </>;
}
