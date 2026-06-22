import { X } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { ProjectIntervention } from '../../hooks/useKSwarmClient';
import { useLocale } from '../../contexts/LocaleContext';

interface ProjectInterventionDetailDrawerProps {
  intervention: ProjectIntervention;
  onClose(): void;
}

export function ProjectInterventionDetailDrawer({ intervention, onClose }: ProjectInterventionDetailDrawerProps) {
  const { t } = useLocale();
  const failure = intervention.primaryFailure;
  const closeFromButton = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-label={t.projectsInterventionReasonTitle}
        className="h-full w-[min(420px,100vw)] border-l border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-[14px] font-semibold text-[var(--c-text-heading)]">{t.projectsInterventionReasonTitle}</h2>
          <button
            type="button"
            aria-label={t.commonClose}
            onMouseDown={closeFromButton}
            onClick={closeFromButton}
            className="ml-auto rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-[12px]">
          <DetailRow label={t.projectsInterventionTaskLabel} value={intervention.primaryTaskTitle || intervention.primaryTaskId || t.projectsInterventionUnknownTask} />
          <DetailRow label={t.projectsInterventionCurrentJudgment} value={intervention.message || t.projectsInterventionDefaultJudgment} />
          {failure?.reason && <DetailRow label={t.projectsInterventionFailureReasonLabel} value={failure.reason} />}
          {failure?.feedback && <DetailRow label={t.projectsInterventionFeedbackLabel} value={failure.feedback} />}
          <DetailRow label="" value={t.projectsInterventionImpact(intervention.downstreamBlockedCount || 0)} />
          {intervention.primaryAction?.strategy && <DetailRow label={t.projectsInterventionSystemSuggestion} value={formatStrategy(intervention.primaryAction.strategy, t)} />}
        </div>
      </section>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-[var(--c-text-muted)]">{label}</div>
      <div className="mt-1 whitespace-pre-wrap rounded-lg bg-[var(--c-bg-card)] px-3 py-2 leading-relaxed text-[var(--c-text-secondary)]">
        {value}
      </div>
    </div>
  );
}

function formatStrategy(strategy: string, t: ReturnType<typeof import('../../contexts/LocaleContext').useLocale>['t']) {
  switch (strategy) {
    case 'recover_submission':
      return t.projectsInterventionStrategyRecoverSubmission;
    case 'retry_with_repair_instruction':
      return t.projectsInterventionStrategyRetryRepair;
    case 'complete_retry_parent':
      return t.projectsInterventionStrategyCompleteRetry;
    case 'restart_then_retry':
      return t.projectsInterventionStrategyRestartRetry;
    case 'needs_conversation':
      return t.projectsInterventionStrategyNeedsConversation;
    default:
      return t.projectsInterventionStrategyDefault;
  }
}
