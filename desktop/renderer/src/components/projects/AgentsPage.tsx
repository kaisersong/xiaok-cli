/**
 * AgentsPage — manage kswarm agents (create/edit/start/stop/archive).
 */

import { useState, useEffect } from 'react';
import { Plus, Play, Square, Settings, Trash2, Wifi, WifiOff, Bot } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmAgent, CreateAgentInput, AgentProbe } from '../../hooks/useKSwarmClient';
import { CreateAgentModal } from './CreateAgentModal';
import { EditAgentModal } from './EditAgentModal';

export function AgentsPage() {
  const { agents, fetchAgents, startAgent, stopAgent, archiveAgent, probeAgent, connected } = useKSwarm();
  const { t } = useLocale();
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<KSwarmAgent | null>(null);
  const [probes, setProbes] = useState<Record<string, AgentProbe>>({});
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  // Probe all agents on mount
  useEffect(() => {
    if (agents.length === 0) return;
    agents.forEach(agent => {
      if (agent.runtimeType) {
        probeAgent(agent.id).then(p => {
          if (p) setProbes(prev => ({ ...prev, [agent.id]: p }));
        });
      }
    });
  }, [agents, probeAgent]);

  const handleStart = async (id: string) => {
    await startAgent(id);
  };

  const handleStop = async (id: string) => {
    await stopAgent(id);
  };

  const handleArchive = async (id: string) => {
    await archiveAgent(id);
    setConfirmArchive(null);
  };

  const getStatusStyle = (status: KSwarmAgent['status']) => {
    switch (status) {
      case 'idle': return { dot: 'bg-[var(--c-status-success-text)]', label: t.projectsAgentStatusIdle };
      case 'working': return { dot: 'bg-[var(--c-status-warning-text)] animate-pulse', label: t.projectsAgentStatusWorking };
      case 'blocked': return { dot: 'bg-[var(--c-status-warning-text)]', label: t.projectsAgentStatusBlocked };
      case 'error': return { dot: 'bg-[var(--c-status-error-text)]', label: t.projectsAgentStatusError };
      default: return { dot: 'bg-[var(--c-text-muted)]', label: t.projectsAgentStatusOffline };
    }
  };

  const getRoleLabel = (agent: KSwarmAgent) => {
    const isPO = agent.roles?.includes('project_owner');
    const isWorker = agent.roles?.includes('worker');
    if (isPO && isWorker) return t.projectsAgentRoleAll;
    if (isPO) return t.projectsAgentRolePo;
    if (isWorker) return t.projectsAgentRoleWorker;
    return t.projectsAgentRoleUniversal;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--c-border-subtle)] px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-[14px] font-semibold text-[var(--c-text-heading)]">{t.projectsPageAgents}</h1>
          <span className="text-[11px] text-[var(--c-text-muted)]">{t.projectsAgentCountLabel(agents.length)}</span>
          {!connected && (
            <span className="rounded-full bg-[var(--c-error-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--c-status-warning-text)]">
              {t.projectsPageOffline}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--c-btn-bg)] px-3.5 py-1.5 text-sm font-medium text-[var(--c-btn-text)] transition-[filter] duration-150 hover:brightness-[1.12] active:brightness-[0.95]"
        >
          <Plus size={15} />
          <span>{t.projectsPageNewAgent}</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {agents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex size-16 items-center justify-center rounded-xl bg-[var(--c-bg-deep)]">
              <Bot size={28} className="text-[var(--c-text-secondary)]" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--c-text-primary)]">{t.projectsAgentNoAgents}</p>
              <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">
                {t.projectsAgentCreateHint}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-2 flex items-center gap-1.5 rounded-lg border-[0.5px] border-[var(--c-border-subtle)] px-4 py-1.5 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
            >
              <Plus size={15} />
              <span>{t.projectsAgentCreateFirstAgent}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {agents.map(agent => {
              const { dot, label } = getStatusStyle(agent.status);
              const probe = probes[agent.id];
              const isOnline = agent.status !== 'offline';

              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-4 rounded-xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4 transition-colors duration-150 hover:bg-[var(--c-bg-deep)]"
                >
                  {/* Avatar */}
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
                    <span className="text-sm font-bold text-[var(--c-text-secondary)]">
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--c-text-primary)] truncate">
                        {agent.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[10px] text-[var(--c-text-muted)]">
                        {getRoleLabel(agent)}
                      </span>
                      {agent.runtimeType && (
                        <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[10px] text-[var(--c-text-muted)]">
                          {agent.runtimeType}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className={`size-1.5 rounded-full ${dot}`} />
                      <span className="text-[11px] text-[var(--c-text-muted)]">{label}</span>
                      {probe && (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--c-text-muted)]">
                          {probe.healthy ? (
                            <Wifi size={10} className="text-[var(--c-status-success-text)]" />
                          ) : (
                            <WifiOff size={10} className="text-[var(--c-status-error-text)]" />
                          )}
                          {probe.version && <span>v{probe.version}</span>}
                          {probe.error && <span className="text-[var(--c-status-error-text)]">{probe.error}</span>}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {isOnline ? (
                      <button
                        type="button"
                        onClick={() => handleStop(agent.id)}
                        className="rounded-md p-1.5 text-[var(--c-status-error-text)] hover:bg-[var(--c-bg-deep)] transition-colors duration-150"
                        title={t.projectsAgentStop}
                      >
                        <Square size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStart(agent.id)}
                        className="rounded-md p-1.5 text-[var(--c-status-success-text)] hover:bg-[var(--c-bg-deep)] transition-colors duration-150"
                        title={t.projectsAgentStart}
                      >
                        <Play size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingAgent(agent)}
                      className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors duration-150"
                      title={t.projectsAgentConfig}
                    >
                      <Settings size={14} />
                    </button>
                    {confirmArchive === agent.id ? (
                      <div className="flex items-center gap-1 ml-1">
                        <button
                          type="button"
                          onClick={() => handleArchive(agent.id)}
                          className="rounded-md px-2 py-1 text-[10px] font-medium bg-[var(--c-status-error-text)] text-white"
                        >
                          {t.commonConfirm}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmArchive(null)}
                          className="rounded-md px-2 py-1 text-[10px] font-medium text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"
                        >
                          {t.commonCancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmArchive(agent.id)}
                        className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-status-error-text)] transition-colors duration-150"
                        title={t.projectsAgentArchive}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateAgentModal open={showCreate} onClose={() => setShowCreate(false)} />
      {editingAgent && (
        <EditAgentModal agent={editingAgent} onClose={() => setEditingAgent(null)} />
      )}
    </div>
  );
}
