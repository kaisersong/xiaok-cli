import { X } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { ProjectIntervention } from '../../hooks/useKSwarmClient';

interface ProjectInterventionDetailDrawerProps {
  intervention: ProjectIntervention;
  onClose(): void;
}

export function ProjectInterventionDetailDrawer({ intervention, onClose }: ProjectInterventionDetailDrawerProps) {
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
        aria-label="处理原因"
        className="h-full w-[min(420px,100vw)] border-l border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-[14px] font-semibold text-[var(--c-text-heading)]">处理原因</h2>
          <button
            type="button"
            aria-label="关闭"
            onMouseDown={closeFromButton}
            onClick={closeFromButton}
            className="ml-auto rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-[12px]">
          <DetailRow label="任务" value={intervention.primaryTaskTitle || intervention.primaryTaskId || '未知任务'} />
          <DetailRow label="当前判断" value={intervention.message || '需要处理后才能继续推进。'} />
          {failure?.reason && <DetailRow label="失败原因" value={failure.reason} />}
          {failure?.feedback && <DetailRow label="反馈" value={failure.feedback} />}
          <DetailRow label="影响" value={`后续 ${intervention.downstreamBlockedCount || 0} 个任务受影响。`} />
          {intervention.primaryAction?.strategy && <DetailRow label="系统建议" value={formatStrategy(intervention.primaryAction.strategy)} />}
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

function formatStrategy(strategy: string) {
  switch (strategy) {
    case 'recover_submission':
      return '恢复已生成的产物并进入审核。';
    case 'retry_with_repair_instruction':
      return '带着质量反馈重新执行任务。';
    case 'complete_retry_parent':
      return '补齐已成功重试任务的父任务状态。';
    case 'restart_then_retry':
      return '重置过期执行后重新派发。';
    case 'needs_conversation':
      return '当前不能安全自动推进，需要让小K帮忙确认。';
    default:
      return '重新派发任务继续推进。';
  }
}
