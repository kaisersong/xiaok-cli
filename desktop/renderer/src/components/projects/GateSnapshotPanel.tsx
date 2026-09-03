/**
 * GateSnapshotPanel — 消费 KSwarm getProjectGateSnapshot / 用户批准 gate action
 * （design §9.3：Desktop preload 提供 getProjectGateSnapshot(projectId) /
 * submitUserGateAction(...)）。
 *
 * 现状核实（2026-09-02）：这两个能力此前已经在 main process 侧通过
 * kswarm-ipc-proxy.ts 的白名单放行（GET /projects/:id/gate-snapshot，
 * POST /projects/:id/final-deliverables/:id/approve），但 renderer 侧完全没有
 * 任何组件调用它们——"可用但未被消费"。本组件是第一个真实消费方。
 *
 * 展示范围严格对齐 hub.js:getProjectGateSnapshot 返回的 allowlist DTO：
 * phase、counts、conditionSummaries、artifacts（仅 artifactId/sha256）、
 * userActions；不假造任何 DTO 里不存在的字段。
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, Clock } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';

interface ConditionSummary {
  conditionId: string;
  severity: string;
  status: string;
  blocking: boolean;
}

interface GateArtifactRef {
  artifactId: string;
  sha256: string;
}

interface UserGateAction {
  action: string;
  deliverableId?: string;
}

interface ProjectGateSnapshot {
  projectId: string;
  phase: string | null;
  counts: Record<string, number> | null;
  conditionSummaries: ConditionSummary[];
  artifacts: GateArtifactRef[];
  userActions: UserGateAction[];
}

interface GateSnapshotPanelProps {
  projectId: string;
}

async function fetchGateSnapshot(projectId: string): Promise<ProjectGateSnapshot | null> {
  const api = getDesktopApi();
  if (!api?.kswarmProxyGet) return null;
  const raw = await api.kswarmProxyGet(`/projects/${encodeURIComponent(projectId)}/gate-snapshot`);
  const payload = raw as { ok?: boolean; snapshot?: ProjectGateSnapshot } | null;
  if (!payload?.ok || !payload.snapshot) return null;
  return payload.snapshot;
}

async function approveFinalDeliverable(deliverableId: string, projectId: string): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.kswarmProxyPost) return false;
  const result = await api.kswarmProxyPost(
    `/projects/${encodeURIComponent(projectId)}/final-deliverables/${encodeURIComponent(deliverableId)}/approve`,
    { approvalIdempotencyKey: `desktop-ui-${deliverableId}-${Date.now()}` },
  ) as { ok?: boolean } | null;
  return Boolean(result?.ok);
}

export function GateSnapshotPanel({ projectId }: GateSnapshotPanelProps) {
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<ProjectGateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchGateSnapshot(projectId);
      setSnapshot(next);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return null;
  if (!snapshot) return null;

  const blockingConditions = snapshot.conditionSummaries.filter(condition => condition.blocking && condition.status !== 'resolved');
  const approveAction = snapshot.userActions.find(action => action.action === 'approve_final_deliverable');

  const handleApprove = async () => {
    if (!approveAction?.deliverableId) return;
    setApproving(true);
    try {
      const ok = await approveFinalDeliverable(approveAction.deliverableId, projectId);
      if (ok) await reload();
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        {blockingConditions.length > 0 ? (
          <ShieldAlert size={16} className="text-[var(--c-status-warning)]" />
        ) : approveAction ? (
          <Clock size={16} className="text-[var(--c-text-muted)]" />
        ) : (
          <CheckCircle2 size={16} className="text-[var(--c-status-success)]" />
        )}
        <span className="text-[13px] font-medium text-[var(--c-text-primary)]">
          {blockingConditions.length > 0
            ? t.projectVerificationBlocked
            : approveAction
              ? t.projectFinalApprovalRequired
              : t.projectExecutionCompleted}
        </span>
      </div>

      {blockingConditions.length > 0 && (
        <p className="text-[12px] text-[var(--c-text-muted)]">
          {t.projectOpenConditionsCount(blockingConditions.length)}
        </p>
      )}

      {approveAction && (
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={approving}
          className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
        >
          {t.projectFinalApprovalRequired}
        </button>
      )}
    </div>
  );
}
