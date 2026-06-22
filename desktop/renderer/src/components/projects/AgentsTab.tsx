/**
 * AgentsTab — agent management tab embedded in ProjectsPage.
 */

import { useState, useEffect } from 'react';
import { Play, Square, Settings, Trash2, Wifi, WifiOff, Bot, Circle, Loader, Clock, AlertTriangle, XCircle, CheckCircle2, CircleOff } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmAgent, AgentProbe } from '../../hooks/useKSwarmClient';
import { EditAgentModal } from './EditAgentModal';

export function AgentsTab() {
  const { agents, fetchAgents, startAgent, stopAgent, archiveAgent, probeAgent, pingHeartbeat, connected } = useKSwarm();
  const { t } = useLocale();
  const [editingAgent, setEditingAgent] = useState<KSwarmAgent | null>(null);
  const [probes, setProbes] = useState<Record<string, AgentProbe>>({});
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  // Ping heartbeats for online agents periodically
  useEffect(() => {
    const onlineAgents = agents.filter(a => a.status !== 'offline');
    if (onlineAgents.length === 0) return;
    const timer = setInterval(() => {
      onlineAgents.forEach(a => { pingHeartbeat(a.id).catch(() => {}); });
    }, 15_000);
    return () => clearInterval(timer);
  }, [agents.map(a => `${a.id}:${a.status}`).join(','), pingHeartbeat]);

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

  const handleStart = async (id: string) => { await startAgent(id); await fetchAgents(); };
  const handleStop = async (id: string) => { await stopAgent(id); await fetchAgents(); };
  const handleArchive = async (id: string) => { await archiveAgent(id); await fetchAgents(); setConfirmArchive(null); };

  const getStatusStyle = (status: KSwarmAgent['status']) => {
    switch (status) {
      case 'idle': return { Icon: Circle, iconClass: 'text-[var(--c-status-success-text)]', label: t.projectsAgentStatusIdle };
      case 'working': return { Icon: Loader, iconClass: 'text-[var(--c-accent)] animate-spin', label: t.projectsAgentStatusWorking };
      case 'blocked': return { Icon: Clock, iconClass: 'text-[var(--c-status-warning-text)]', label: t.projectsAgentStatusBlocked };
      case 'error': return { Icon: XCircle, iconClass: 'text-[var(--c-status-error-text)]', label: t.projectsAgentStatusError };
      default: return { Icon: CircleOff, iconClass: 'text-[var(--c-text-muted)]', label: t.projectsAgentStatusOffline };
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
    <div className="p-6">
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <div className="flex size-16 items-center justify-center rounded-xl bg-[var(--c-bg-deep)]">
            <Bot size={28} className="text-[var(--c-text-secondary)]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--c-text-primary)]">{t.projectsAgentNoAgents}</p>
            <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">{t.projectsAgentCreateAgentTabHint}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {agents.map(agent => {
            const { Icon, iconClass, label } = getStatusStyle(agent.status);
            const probe = probes[agent.id];
            const isOnline = agent.status !== 'offline';
            return (
              <div key={agent.id} className="flex items-center gap-4 rounded-xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4 hover:bg-[var(--c-bg-deep)]">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--c-bg-deep)]">
                  <span className="text-sm font-bold text-[var(--c-text-secondary)]">{agent.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--c-text-primary)] truncate">{agent.name}</span>
                    <span className="rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[10px] text-[var(--c-text-muted)]">{getRoleLabel(agent)}</span>
                    {agent.runtimeType && <span className="rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[10px] text-[var(--c-text-muted)]">{agent.runtimeType}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Icon size={12} className={iconClass} />
                    <span className="text-[11px] text-[var(--c-text-muted)]">{label}</span>
                    {probe && (
                      <span className="flex items-center gap-1 text-[10px] text-[var(--c-text-muted)]">
                        {probe.healthy ? <Wifi size={10} className="text-[var(--c-status-success-text)]" /> : <WifiOff size={10} className="text-[var(--c-status-error-text)]" />}
                        {probe.version && <span>v{probe.version}</span>}
                        {probe.error && <span className="text-[var(--c-status-error-text)]">{probe.error}</span>}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {isOnline ? (
                    <button type="button" onClick={() => handleStop(agent.id)} className="rounded-md p-1.5 text-[var(--c-status-error-text)] hover:bg-[var(--c-bg-deep)]" title={t.projectsAgentStop}><Square size={14} /></button>
                  ) : (
                    <button type="button" onClick={() => handleStart(agent.id)} className="rounded-md p-1.5 text-[var(--c-status-success-text)] hover:bg-[var(--c-bg-deep)]" title={t.projectsAgentStart}><Play size={14} /></button>
                  )}
                  <button type="button" onClick={() => setEditingAgent(agent)} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]" title={t.projectsAgentConfig}><Settings size={14} /></button>
                  {confirmArchive === agent.id ? (
                    <div className="flex items-center gap-1 ml-1">
                      <button type="button" onClick={() => handleArchive(agent.id)} className="rounded-md px-2 py-1 text-[10px] font-medium bg-[var(--c-status-error-text)] text-white">{t.projectsAgentConfirm}</button>
                      <button type="button" onClick={() => setConfirmArchive(null)} className="rounded-md px-2 py-1 text-[10px] font-medium text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">{t.commonCancel}</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmArchive(agent.id)} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-status-error-text)]" title={t.projectsAgentArchive}><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingAgent && <EditAgentModal agent={editingAgent} onClose={() => setEditingAgent(null)} />}
    </div>
  );
}
