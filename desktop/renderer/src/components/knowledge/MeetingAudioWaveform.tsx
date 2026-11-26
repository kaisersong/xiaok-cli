import { useLocale } from '../../contexts/LocaleContext';

export function MeetingAudioWaveform({
  audioLevels,
  active,
  paused,
  compact = false,
}: {
  audioLevels: number[];
  active: boolean;
  paused: boolean;
  compact?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div
      className={`flex items-center justify-center gap-1 ${compact ? 'h-6' : 'h-12'}`}
      role="meter"
      aria-label={t.knowledge.meetingAudioLevelLabel}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.max(...audioLevels, 0)}
    >
      {audioLevels.map((level, index) => {
        const normalized = Math.max(0, Math.min(1, level));
        const maxHeight = compact ? 24 : 34;
        return (
          <span
            key={index}
            data-audio-level={normalized.toFixed(2)}
            className={`w-1 shrink-0 rounded-full transition-[height,background-color] duration-100 ${active && !paused ? 'bg-[var(--c-accent)]' : paused ? 'bg-amber-400' : 'bg-[var(--c-border)]'}`}
            style={{ height: `${Math.max(4, Math.round(4 + Math.sqrt(normalized) * maxHeight))}px` }}
          />
        );
      })}
    </div>
  );
}
