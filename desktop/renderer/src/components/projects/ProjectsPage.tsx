/**
 * ProjectsPage — project list + agent management in one page with tabs.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderKanban, ArrowLeft, Download } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import { ProjectCard } from './ProjectCard';
import { CreateProjectModal } from './CreateProjectModal';
import { CreateAgentModal } from './CreateAgentModal';
import { AgentsTab } from './AgentsTab';
import { PrinciplesTab } from './PrinciplesTab';

type TabId = 'projects' | 'agents' | 'principles';

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, agents, createProject, connected } = useKSwarm();
  const { t } = useLocale();
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('projects');
  const [principleAddTrigger, setPrincipleAddTrigger] = useState(0);
  const [principleImportTrigger, setPrincipleImportTrigger] = useState(0);

  const handleCreate = async (input: Parameters<typeof createProject>[0]) => {
    await createProject(input);
  };

  const TABS: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'projects', label: t.projectsPageTitle, count: projects.length },
    { id: 'agents', label: t.projectsPageAgents, count: agents.length },
    { id: 'principles', label: t.projectsPrinciplesTab },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header with tabs */}
      <div className="flex items-center justify-between border-b border-[var(--c-border-subtle)] px-6 py-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => navigate('/')} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]" title={t.appLayoutBack}>
            <ArrowLeft size={16} />
          </button>
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12px] font-medium transition-colors duration-150 ${
                activeTab === tab.id
                  ? 'border-[var(--c-text-primary)] text-[var(--c-text-primary)]'
                  : 'border-transparent text-[var(--c-text-muted)] hover:text-[var(--c-text-secondary)]'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-[10px] text-[var(--c-text-muted)]">{tab.count}</span>
              )}
            </button>
          ))}
          {!connected && (
            <span className="rounded-full bg-[var(--c-error-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--c-status-warning-text)]">
              {t.projectsPageOffline}
            </span>
          )}
        </div>
        {activeTab === 'projects' && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--c-btn-bg)] px-3.5 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] active:brightness-[0.95]"
          >
            <Plus size={15} />
            <span>{t.projectsPageNewProject}</span>
          </button>
        )}
        {activeTab === 'agents' && (
          <button
            type="button"
            onClick={() => setShowCreateAgent(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--c-btn-bg)] px-3.5 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] active:brightness-[0.95]"
          >
            <Plus size={15} />
            <span>{t.projectsPageNewAgent}</span>
          </button>
        )}
        {activeTab === 'principles' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPrincipleImportTrigger(n => n + 1)}
              className="flex items-center gap-1.5 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
            >
              <Download size={15} />
              <span>{t.projectsPrinciplesImportMemory}</span>
            </button>
            <button
              type="button"
              onClick={() => setPrincipleAddTrigger(n => n + 1)}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--c-btn-bg)] px-3.5 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] active:brightness-[0.95]"
            >
              <Plus size={15} />
              <span>{t.projectsPrinciplesAdd}</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'projects' && (
          projects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-xl bg-[var(--c-bg-deep)]">
                <FolderKanban size={28} className="text-[var(--c-text-secondary)]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-[var(--c-text-primary)]">{t.projectsPageEmpty}</p>
                <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">
                  {t.projectsPageEmptyDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="mt-2 flex items-center gap-1.5 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] px-4 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
              >
                <Plus size={15} />
                <span>{t.projectsPageCreateFirst}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map(project => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )
        )}
        {activeTab === 'agents' && (
          <AgentsTab />
        )}
        {activeTab === 'principles' && (
          <PrinciplesTab addTrigger={principleAddTrigger} importTrigger={principleImportTrigger} />
        )}
      </div>

      {/* Create project modal */}
      <CreateProjectModal
        open={showCreate}
        agents={agents}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />

      {/* Create agent modal */}
      <CreateAgentModal
        open={showCreateAgent}
        onClose={() => setShowCreateAgent(false)}
      />
    </div>
  );
}
