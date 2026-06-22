import { useState } from 'react';
import { AlertTriangle, Info, MessageCircle, Play } from 'lucide-react';
import type { ProjectIntervention } from '../../hooks/useKSwarmClient';
import { useLocale } from '../../contexts/LocaleContext';
import { ProjectInterventionDetailDrawer } from './ProjectInterventionDetailDrawer';

interface ProjectInterventionBannerProps {
  intervention: ProjectIntervention | null | undefined;
  busy?: boolean;
  onContinue(): void;
  onAskXiaok(): void;
}

function getSecondaryActionLabel(intervention: ProjectIntervention, t: ReturnType<typeof import('../../contexts/LocaleContext').useLocale>['t']): string {
  const label = intervention.secondaryAction?.label?.trim();
  if (!label || label === '问小K') return t.projectsInterventionAskXiaokDefault;
  return label;
}

export function ProjectInterventionBanner({ intervention, busy = false, onContinue, onAskXiaok }: ProjectInterventionBannerProps) {
  const { t } = useLocale();
  const [detailOpen, setDetailOpen] = useState(false);
  if (!intervention?.required) return null;

  return (
    <>
      <div
        role="status"
        className="ml-[38px] rounded-lg border border-[var(--c-status-warning-text)]/30 bg-[var(--c-bg-deep)] px-3 py-2 text-[var(--c-text-secondary)]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle size={13} className="text-[var(--c-status-warning-text)]" />
          <span className="text-[12px] font-semibold text-[var(--c-status-warning-text)]">
            {intervention.headline || t.projectsInterventionDefaultHeadline}
          </span>
          {intervention.primaryTaskTitle && (
            <span className="max-w-[260px] truncate rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-muted)]">
              {intervention.primaryTaskTitle}
            </span>
          )}
        </div>
        {intervention.message && (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--c-text-secondary)]">{intervention.message}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--c-btn-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-btn-text)] hover:brightness-[1.08] disabled:opacity-50"
          >
            <Play size={11} />
            <span>{busy ? t.projectsInterventionBusy : intervention.primaryAction?.label || t.projectsInterventionContinueDefault}</span>
          </button>
          <button
            type="button"
            onClick={onAskXiaok}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--c-bg-page)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-text-primary)] hover:bg-[var(--c-bg-card)] disabled:opacity-50"
          >
            <MessageCircle size={11} />
            <span>{getSecondaryActionLabel(intervention, t)}</span>
          </button>
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)] hover:text-[var(--c-text-primary)]"
          >
            <Info size={11} />
            <span>{t.projectsInterventionViewReason}</span>
          </button>
        </div>
      </div>
      {detailOpen && <ProjectInterventionDetailDrawer intervention={intervention} onClose={() => setDetailOpen(false)} />}
    </>
  );
}
