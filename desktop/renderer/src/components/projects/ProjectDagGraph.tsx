import { useMemo, useState, useEffect, useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, type NodeProps, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExternalLink, Workflow, SkipForward, RefreshCw, ArrowLeft, ClipboardList } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import type { ProjectFullDetail } from '../../hooks/useKSwarmClient';
import { buildDagFromProject, layoutWithDagre, STATUS_STYLE, GRAPH_NODE_LIMIT, PO_PLAN_NODE_ID, type DagNode } from './dagGraphModel';
import { computeAnimationSchedule, ANIM, PLAYED_TOPOLOGIES } from './dagGraphAnimation';
import { DagNodeDetailDrawer } from './DagNodeDetailDrawer';

interface Props {
  detail: ProjectFullDetail;
  onJumpToBoard: (taskId?: string) => void;
}

function DagNodeCard({ data }: NodeProps) {
  const { t } = useLocale();
  const nodeData = data as unknown as DagNode;
  const style = STATUS_STYLE[nodeData.status];
  const pulse = nodeData.status === 'running';
  const isPo = nodeData.kind === 'po_plan';
  const borderWidth = nodeData.status === 'done' ? 4 : 3;

  const STATUS_LABELS: Record<string, string> = {
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

  return (
    <div
      title={nodeData.errorMessage || nodeData.title}
      style={{
        borderLeft: `${borderWidth}px solid ${isPo ? 'var(--c-graph-node-plan-border)' : style.border}`,
        background: isPo ? 'var(--c-graph-node-plan-bg)' : style.bg,
        padding: '8px 12px',
        borderRadius: 6,
        width: 220,
        minHeight: 76,
        fontSize: 12,
        cursor: 'pointer',
        animation: pulse ? 'dagNodePulse 2s ease-in-out infinite' : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div className="flex items-center gap-1">
        {isPo && <ClipboardList size={12} className="shrink-0 text-[var(--c-accent)]" />}
        <span className="flex-1 truncate font-medium text-[var(--c-text-primary)]">{nodeData.title}</span>
        {nodeData.hasTaskWorkflow && <Workflow size={12} className="shrink-0 text-[var(--c-accent)]" />}
        {nodeData.taskId && <ExternalLink size={12} className="shrink-0 text-[var(--c-text-muted)]" />}
      </div>
      {nodeData.agentName && (
        <div className="truncate text-xs text-[var(--c-text-secondary)]">{nodeData.agentName}</div>
      )}
      <div className="text-[10px] text-[var(--c-text-tertiary)]">
        {isPo ? t.projectsDetailGraphPoPlanLabel : (STATUS_LABELS[nodeData.status] ?? '—')}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

const NODE_TYPES = { dag: DagNodeCard };

function EmptyState({ reason, count, onReturn }: { reason: string; count?: number; onReturn?: () => void }) {
  const { t } = useLocale();
  let message = '';
  switch (reason) {
    case 'no_tasks': message = t.projectsDetailGraphEmptyNoTasks; break;
    case 'task_board_no_deps': message = t.projectsDetailGraphEmptyTaskBoardNoDeps; break;
    case 'workflow_not_started': message = t.projectsDetailGraphEmptyWorkflowNotStarted; break;
    case 'too_large': message = t.projectsDetailGraphEmptyTooLarge(count ?? GRAPH_NODE_LIMIT); break;
    default: message = '';
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--c-text-tertiary)]">
      <p>{message}</p>
      {onReturn && (
        <button
          type="button"
          onClick={onReturn}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-[var(--c-accent)] hover:bg-[var(--c-bg-deep)]"
        >
          <ArrowLeft size={12} />
          {t.projectsDetailGraphReturnToBoard}
        </button>
      )}
    </div>
  );
}

export default function ProjectDagGraph({ detail, onJumpToBoard }: Props) {
  const { t } = useLocale();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const graph = useMemo(() => buildDagFromProject(detail), [detail]);

  const topologyKey = useMemo(
    () => graph.nodes.map(n => n.id).sort().join('|') + '#' + graph.edges.map(e => e.id).sort().join('|'),
    [graph.nodes, graph.edges],
  );

  const layouted = useMemo(() => layoutWithDagre(graph), [topologyKey]);

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const [animEnabled, setAnimEnabled] = useState(() => {
    if (reducedMotion) return false;
    const lastKey = PLAYED_TOPOLOGIES.get(detail.project.id);
    return lastKey !== topologyKey;
  });

  const schedule = useMemo(
    () => animEnabled ? computeAnimationSchedule(graph) : null,
    [animEnabled, topologyKey],
  );

  useEffect(() => {
    if (!animEnabled || !schedule) return;
    const timer = setTimeout(() => {
      PLAYED_TOPOLOGIES.set(detail.project.id, topologyKey);
      setAnimEnabled(false);
    }, schedule.totalDuration);
    return () => clearTimeout(timer);
  }, [animEnabled, schedule, detail.project.id, topologyKey]);

  const handleSkip = useCallback(() => {
    PLAYED_TOPOLOGIES.set(detail.project.id, topologyKey);
    setAnimEnabled(false);
  }, [detail.project.id, topologyKey]);

  const handleReplay = useCallback(() => {
    PLAYED_TOPOLOGIES.delete(detail.project.id);
    setAnimEnabled(false);
    requestAnimationFrame(() => setAnimEnabled(true));
  }, [detail.project.id]);

  const nodes = useMemo(() => {
    return layouted.nodes.map(n => {
      const nodeData = graph.nodes.find(g => g.id === n.id)!;
      const highlightTime = schedule?.nodeHighlights.get(n.id);
      const className = highlightTime !== undefined
        ? (nodeData.status === 'failed' || nodeData.status === 'blocked' ? 'dag-node-warn-anim' : 'dag-node-anim')
        : undefined;
      return {
        ...n,
        data: nodeData as unknown as Record<string, unknown>,
        className,
        style: highlightTime !== undefined
          ? { '--anim-delay': `${highlightTime}ms` } as React.CSSProperties
          : undefined,
      };
    });
  }, [layouted.nodes, graph.nodes, schedule]);

  const edges = useMemo(() => {
    return layouted.edges.map(e => {
      const delay = schedule?.edgeDelays.get(e.id);
      if (delay == null) return e;
      return {
        ...e,
        className: 'dag-edge-anim',
        style: {
          ...e.style,
          '--anim-delay': `${delay}ms`,
          '--anim-duration': `${ANIM.EDGE_DURATION}ms`,
        } as React.CSSProperties,
      };
    });
  }, [layouted.edges, schedule]);

  const selectedNode = useMemo(
    () => selectedNodeId ? graph.nodes.find(n => n.id === selectedNodeId) ?? null : null,
    [selectedNodeId, graph.nodes],
  );

  if (graph.emptyReason === 'no_tasks') return <EmptyState reason="no_tasks" />;
  if (graph.emptyReason === 'task_board_no_deps') {
    return <EmptyState reason="task_board_no_deps" onReturn={() => onJumpToBoard()} />;
  }
  if (graph.emptyReason === 'workflow_not_started') return <EmptyState reason="workflow_not_started" />;
  if (graph.emptyReason === 'too_large') return <EmptyState reason="too_large" count={graph.nodes.length} />;

  const fitView = graph.nodes.length <= 8;

  return (
    <div className="relative h-full w-full" style={{ minHeight: 400 }}>
      {graph.partial && (
        <div className="absolute left-3 top-3 z-10 rounded-md bg-[var(--c-bg-deep)] px-2 py-1 text-[10px] text-[var(--c-text-tertiary)]">
          {t.projectsDetailGraphPartialBanner}
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex gap-1">
        {animEnabled && (
          <button
            type="button"
            onClick={handleSkip}
            title={t.projectsDetailGraphSkip}
            aria-label={t.projectsDetailGraphSkip}
            className="rounded-md p-1.5 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
          >
            <SkipForward size={14} />
          </button>
        )}
        {!animEnabled && (
          <button
            type="button"
            onClick={handleReplay}
            title={t.projectsDetailGraphReplay}
            aria-label={t.projectsDetailGraphReplay}
            className="rounded-md p-1.5 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges as unknown as Edge[]}
        nodeTypes={NODE_TYPES}
        fitView={fitView}
        fitViewOptions={{ minZoom: 0.8, maxZoom: 1, padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
        }}
      >
        <Background />
        <Controls showInteractive={false} />
        {graph.nodes.length > 30 && <MiniMap pannable zoomable />}
      </ReactFlow>
      {selectedNode && (
        <DagNodeDetailDrawer
          node={selectedNode}
          graph={graph}
          onClose={() => setSelectedNodeId(null)}
          onJumpToBoard={(taskId) => { setSelectedNodeId(null); onJumpToBoard(taskId); }}
          onSelectNode={(id) => { if (id !== PO_PLAN_NODE_ID || graph.nodes.some(n => n.id === id)) setSelectedNodeId(id); }}
        />
      )}
    </div>
  );
}
