import { AppConnectorsSettings } from './settings/AppConnectorsSettings';
import { useState } from 'react';
import {DshSourceSettings} from './DshSourceSettings';
import {
  ChevronLeft,
  Settings,
  Cpu,
  Palette,
  SlidersHorizontal,
  Plug,
  Puzzle,
  Globe,
  Info,
  HardDrive,
  Zap,
  Brain,
  Wrench,
  Smartphone,
  Mic,
} from 'lucide-react';
import { DesktopAppearanceSettings } from './settings/DesktopAppearanceSettings';
import { useLocale } from '../contexts/LocaleContext';
import { ModelSettingsPane } from './settings/ModelSettingsPane';
import type { ModelSettingsTab } from './settings/ModelSettingsPane';
import { VoicePane } from './settings/VoicePane';
import { MobilePane } from './settings/MobilePane';
import { SkillsPane } from './settings/SkillsPane';
import { ChannelsPane } from './settings/ChannelsPane';
import { McpPane } from './settings/McpPane';
import { GeneralPane } from './settings/GeneralPane';
import { MemoryPane } from './settings/MemoryPane';
import { DataPane } from './settings/DataPane';
import { AboutPane } from './settings/AboutPane';
import { ToolsPane } from './settings/ToolsPane';

export { LoopsPane } from './settings/LoopsPane';

type SettingsTab = 'model' | 'skills' | 'channels' | 'connectors' | 'mcp' | 'tools' | 'general' | 'dsh' | 'mobile' | 'voice' | 'appearance' | 'data' | 'memory' | 'about';

interface NavItem {
  key: SettingsTab;
  icon: typeof Settings;
  label: string;
}

function getNavItems(t: ReturnType<typeof useLocale>['t']): NavItem[] {
  return [
    { key: 'general', icon: SlidersHorizontal, label: t.desktopSettings.navGeneral },
    { key: 'dsh', icon: Zap, label: t.dshSourceSettings.title },
    { key: 'mobile', icon: Smartphone, label: t.desktopSettings.navMobile },
    { key: 'voice', icon: Mic, label: t.desktopSettings.voice },
    { key: 'model', icon: Cpu, label: t.desktopSettings.navModel },
    { key: 'skills', icon: Puzzle, label: t.desktopSettings.navSkills },
    { key: 'connectors', icon: Plug, label: t.nav.connectors },
    { key: 'channels', icon: Globe, label: t.desktopSettings.navChannels },
    { key: 'mcp', icon: Plug, label: t.desktopSettings.navMcp },
    { key: 'tools', icon: Wrench, label: t.desktopSettings.navTools },
    { key: 'appearance', icon: Palette, label: t.desktopSettings.navAppearance },
    { key: 'data', icon: HardDrive, label: t.desktopSettings.navData },
    { key: 'memory', icon: Brain, label: t.desktopSettings.navMemory },
    { key: 'about', icon: Info, label: t.desktopSettings.navAbout },
  ];
}

interface Props {
  onClose: () => void;
}

export function DesktopSettings({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [modelTab, setModelTab] = useState<ModelSettingsTab>('conversation');
  const { t } = useLocale();
  const navItems = getNavItems(t);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--c-bg-page)]">
      {/* Navigation sidebar */}
      <div
        className="flex w-[200px] shrink-0 flex-col overflow-y-auto"
        style={{ borderRight: '0.5px solid var(--c-border)', paddingTop: 12 }}
      >
        <div className="p-3">
          <button type="button"
            onClick={onClose}
            className="flex h-[36px] w-full items-center gap-2 rounded-lg px-3 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
          >
            <ChevronLeft size={16} />
            <span>{t.desktopSettings.back}</span>
          </button>
        </div>
        <div className="px-3">
          <div className="flex flex-col gap-[2px]">
            {navItems.map(({ key, icon: Icon, label }) => {
              const navLabel = label;
              return (
              <button type="button"
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  'flex h-[36px] items-center gap-2.5 rounded-lg px-3 text-sm transition-all',
                  activeTab === key
                    ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)]'
                    : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]',
                ].join(' ')}
              >
                <Icon size={16} />
                <span>{navLabel}</span>
              </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className={`px-8 py-6 ${activeTab === 'connectors' ? 'w-full max-w-[1100px]' : 'max-w-[700px]'}`}>
          {activeTab === 'model' && <ModelSettingsPane activeTab={modelTab} onSelect={setModelTab} />}
          {activeTab === 'skills' && <SkillsPane />}
          {activeTab === 'channels' && <ChannelsPane />}
          {activeTab === 'mcp' && <McpPane />}
          {activeTab === 'connectors' && <AppConnectorsSettings />}
          {activeTab === 'tools' && <ToolsPane />}
          {activeTab === 'general' && <GeneralPane />}
          {activeTab === 'dsh' && <DshSourceSettings />}
          {activeTab === 'mobile' && <MobilePane />}
          {activeTab === 'voice' && <VoicePane />}
          {activeTab === 'appearance' && <DesktopAppearanceSettings />}
          {activeTab === 'data' && <DataPane />}
          {activeTab === 'memory' && <MemoryPane onOpenDecisionModels={() => { setModelTab('decision'); setActiveTab('model'); }} />}
          {activeTab === 'about' && <AboutPane />}
        </div>
      </div>
    </div>
  );
}
