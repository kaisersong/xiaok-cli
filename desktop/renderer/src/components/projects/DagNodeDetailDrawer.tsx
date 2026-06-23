import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, ChevronRight } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import type { DagGraph, DagNode, DagNodeStatus } from './dagGraphModel';
import { PO_PLAN_NODE_ID } from './dagGraphModel';

interface Props {
  node: DagNode;
  graph: DagGraph;
  onClose: () => void;
  onJumpToBoard?: (taskId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return '';
  const num = typeof ts === 'number' ? ts : Number(ts);
  if (!Number.isFinite(num) || num <= 0) return '';
  return new Date(num).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(start?: number | null, end?: number | null): string {
  if (!start) return '';
  const finish = end ?? Date.now();
  const ms = finish - start;
  if (!Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hour = Math.floor(min / 60);
  return `${hour}h ${min % 60}m`;
}

function statusToneClass(s: DagNodeStatus): string {
  if (s === 'done') return 'text-[var(--c-status-success-text)]';
  if (s === 'failed' || s === 'blocked') return 'text-[var(--c-status-error-text)]';
  if (s === 'running' || s === 'awaiting_review') return 'text-[var(--c-accent)]';
  return 'text-[var(--c-text-muted)]';
}

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => {
    try {
      const s = JSON.stringify(value, null, 2) ?? '';
      return s.length > 4000 ? s.slice(0, 4000) + '\n... (truncated)' : s;
    } catch {
      return String(value);
    }
  }, [value]);

  if (value == null || (typeof value === 'object' && Object.keys(value as object).length === 0)) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1 text-left text-[11px] font-semibold text-[var(--c-text-muted)] hover:text-[var(--c-text-primary)]"
      >
        <ChevronRight size={12} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
        {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-[260px] overflow-auto rounded-md bg-[var(--c-bg-deep)] p-2 text-[11px] leading-relaxed text-[var(--c-text-secondary)]">
          {text}
        </pre>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--c-border-subtle)] py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{title}</div>
      <div className="space-y-2 text-[12px] text-[var(--c-text-primary)]">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === '') return null;
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="w-20 shrink-0 text-[var(--c-text-muted)]">{k}</span>
      <span className="flex-1 break-words text-[var(--c-text-primary)]">{v}</span>
    </div>
  );
}

export function DagNodeDetailDrawer({ node, graph, onClose, onJumpToBoard, onSelectNode }: Props) {
  const { t } = useLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const STATUS_LABELS: Record<DagNodeStatus, string> = {
    pending: t.projectsDetailGraphStatusPending,
    ready: t.projectsDetailGraphStatusReady,
    running: t.projectsDetailGraphStatusRunning,
    awaiting_review: t.projectsDetailGraphStatusReview,
    done: t.projectsDetailGraphStatusDone,
    failed: t.projectsDetailGraphStatusFailed,
    blocked: t.projectsDetailGraphStatusBlocked,
    cancelled: t.projectsDetailGraphStatusCancelled,
    unknown: '—',
  };

  const upstream = useMemo(() => {
    const ids = graph.edges.filter(e => e.target === node.id).map(e => e.source);
    return ids.map(id => graph.nodes.find(n => n.id === id)).filter((n): n is DagNode => Boolean(n));
  }, [graph, node.id]);

  const downstream = useMemo(() => {
    const ids = graph.edges.filter(e => e.source === node.id).map(e => e.target);
    return ids.map(id => graph.nodes.find(n => n.id === id)).filter((n): n is DagNode => Boolean(n));
  }, [graph, node.id]);

  const wfNode = node.workflowNode;
  const taskNode = node.task;
  const poData = node.poPlan;

  const duration = formatDuration(node.startedAt ?? null, node.completedAt ?? null);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-[480px] max-w-[90vw] flex-col bg-[var(--c-bg-card)] shadow-2xl"
        role="dialog"
        aria-label={node.title}
      >
        <div className="flex items-start justify-between gap-2 border-b border-[var(--c-border-subtle)] p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-[var(--c-text-muted)]">
              {node.kind === 'po_plan' ? t.projectsDetailGraphPoPlanLabel
                : node.kind === 'workflow_node' ? t.projectsDetailGraphNodeKindWorkflow
                : t.projectsDetailGraphNodeKindTask}
            </div>
            <div className="mt-1 break-words text-[15px] font-semibold text-[var(--c-text-heading)]">
              {node.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className={statusToneClass(node.status)}>{STATUS_LABELS[node.status]}</span>
              {node.agentName && (
                <span className="text-[var(--c-text-muted)]">· {node.agentName}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
            aria-label={t.projectsDetailGraphDrawerClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {(node.startedAt || node.completedAt) && (
            <Section title={t.projectsDetailGraphDrawerTimeline}>
              <KV k={t.projectsDetailGraphDrawerStartedAt} v={formatTimestamp(node.startedAt)} />
              <KV k={t.projectsDetailGraphDrawerCompletedAt} v={formatTimestamp(node.completedAt)} />
              <KV k={t.projectsDetailGraphDrawerDuration} v={duration} />
            </Section>
          )}

          {node.errorMessage && (
            <Section title={t.projectsDetailGraphDrawerError}>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-[var(--c-graph-node-failed-bg)] p-2 text-[11px] leading-relaxed text-[var(--c-status-error-text)]">
                {node.errorMessage}
              </pre>
            </Section>
          )}

          {node.kind === 'workflow_node' && wfNode && (
            <Section title={t.projectsDetailGraphDrawerWorkflowMeta}>
              <KV k="phase" v={wfNode.phaseId} />
              <KV k="kind" v={wfNode.kind} />
              {typeof wfNode.pipelineStageIndex === 'number' && (
                <KV k={t.projectsDetailGraphDrawerStageIndex} v={String(wfNode.pipelineStageIndex)} />
              )}
              {wfNode.parallelGroupId && (
                <KV k={t.projectsDetailGraphDrawerParallelGroup} v={wfNode.parallelGroupId} />
              )}
              {typeof wfNode.attempt === 'number' && wfNode.attempt > 1 && (
                <KV k={t.projectsDetailGraphDrawerAttempt} v={String(wfNode.attempt)} />
              )}
              {wfNode.producerAgent && wfNode.producerAgent !== wfNode.assignedAgent && (
                <KV k={t.projectsDetailGraphDrawerProducerAgent} v={wfNode.producerAgent} />
              )}
              {wfNode.cache?.status && (
                <KV k={t.projectsDetailGraphDrawerCache} v={wfNode.cache.status} />
              )}
              {wfNode.runtime?.runId && (
                <KV k="runId" v={<span className="font-mono">{wfNode.runtime.runId}</span>} />
              )}
              {wfNode.runtime?.handoffId && (
                <KV k="handoffId" v={<span className="font-mono">{wfNode.runtime.handoffId}</span>} />
              )}
              {wfNode.runtime?.participantId && (
                <KV k="participant" v={<span className="font-mono">{wfNode.runtime.participantId}</span>} />
              )}

              <JsonBlock value={wfNode.input} label={t.projectsDetailGraphDrawerInput} />
              <JsonBlock value={wfNode.output} label={t.projectsDetailGraphDrawerOutput} />
              {wfNode.reviewDecision && (
                <JsonBlock value={wfNode.reviewDecision} label={t.projectsDetailGraphDrawerReview} />
              )}
            </Section>
          )}

          {node.kind === 'task' && taskNode && (
            <Section title={t.projectsDetailGraphDrawerTaskMeta}>
              {taskNode.description && (
                <div className="whitespace-pre-wrap text-[12px] text-[var(--c-text-secondary)]">
                  {taskNode.description}
                </div>
              )}
              {taskNode.acceptanceCriteria && taskNode.acceptanceCriteria.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerAcceptance}
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-[12px] text-[var(--c-text-primary)]">
                    {taskNode.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {taskNode.artifacts && taskNode.artifacts.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerArtifacts}
                  </div>
                  <ul className="space-y-1 text-[12px]">
                    {taskNode.artifacts.map((a, i) => (
                      <li key={i} className="truncate text-[var(--c-text-secondary)]">
                        {a.name || a.filename || a.path || '—'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {taskNode.id && onJumpToBoard && (
                <button
                  type="button"
                  onClick={() => onJumpToBoard(taskNode.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-[11px] text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)]"
                >
                  <ExternalLink size={12} />
                  {t.projectsDetailGraphDrawerOpenInBoard}
                </button>
              )}
            </Section>
          )}

          {node.kind === 'po_plan' && poData && (
            <Section title={t.projectsDetailGraphDrawerPoPlan}>
              {poData.projectGoal && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerProjectGoal}
                  </div>
                  <div className="whitespace-pre-wrap text-[12px] text-[var(--c-text-primary)]">
                    {poData.projectGoal}
                  </div>
                </div>
              )}
              {poData.analysis && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerAnalysis}
                  </div>
                  <div className="whitespace-pre-wrap text-[12px] text-[var(--c-text-secondary)]">
                    {poData.analysis}
                  </div>
                </div>
              )}
              {poData.successCriteria && poData.successCriteria.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerSuccessCriteria}
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-[12px] text-[var(--c-text-primary)]">
                    {poData.successCriteria.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {poData.phases && poData.phases.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerPhases}
                  </div>
                  <ol className="list-decimal space-y-1 pl-4 text-[12px] text-[var(--c-text-primary)]">
                    {poData.phases.map(p => (
                      <li key={String(p.id)}>
                        {p.name}
                        {typeof p.itemCount === 'number' && (
                          <span className="text-[var(--c-text-muted)]"> ({p.itemCount})</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Section>
          )}

          {(upstream.length > 0 || downstream.length > 0) && (
            <Section title={t.projectsDetailGraphDrawerRelations}>
              {upstream.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerUpstream}
                  </div>
                  <ul className="space-y-1">
                    {upstream.map(u => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => onSelectNode?.(u.id)}
                          disabled={u.id === PO_PLAN_NODE_ID && !onSelectNode}
                          className="block w-full truncate text-left text-[12px] text-[var(--c-accent)] hover:underline"
                        >
                          {u.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {downstream.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-[var(--c-text-muted)]">
                    {t.projectsDetailGraphDrawerDownstream}
                  </div>
                  <ul className="space-y-1">
                    {downstream.map(d => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => onSelectNode?.(d.id)}
                          className="block w-full truncate text-left text-[12px] text-[var(--c-accent)] hover:underline"
                        >
                          {d.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}
        </div>
      </aside>
    </>
  );
}
