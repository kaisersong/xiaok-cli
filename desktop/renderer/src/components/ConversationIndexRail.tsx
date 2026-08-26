import { useRef, useState } from 'react';

export interface ConversationIndexEntry {
  id: string;
  preview: string;
  responsePreview?: string;
}

interface ConversationIndexRailProps {
  entries: ConversationIndexEntry[];
  activeId: string | null;
  ariaLabel: string;
  itemLabel: (index: number, preview: string) => string;
  onSelect: (id: string) => void;
}

const IDLE_WIDTH = 10;
const WAVE_WIDTHS = [34, 24, 16] as const;

function railWidth(index: number, hoveredIndex: number | null): number {
  if (hoveredIndex !== null) {
    const distance = Math.abs(index - hoveredIndex);
    return WAVE_WIDTHS[distance] ?? IDLE_WIDTH;
  }
  return IDLE_WIDTH;
}

export function ConversationIndexRail({
  entries,
  activeId,
  ariaLabel,
  itemLabel,
  onSelect,
}: ConversationIndexRailProps) {
  const railRef = useRef<HTMLElement>(null);
  const tickRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipTop, setTooltipTop] = useState<number | null>(null);
  const previewIndex = hoveredIndex;

  const updateTooltipPosition = (index: number, button: HTMLButtonElement) => {
    const railRect = railRef.current?.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (railRect) setTooltipTop(buttonRect.top - railRect.top + buttonRect.height / 2);
    setHoveredIndex(index);
  };

  const clearPreview = () => {
    setHoveredIndex(null);
    setTooltipTop(null);
  };

  if (entries.length < 2) return null;

  return (
    <nav ref={railRef} className="conversation-index-rail" aria-label={ariaLabel}>
      <div
        className="conversation-index-list"
        onMouseLeave={clearPreview}
        onScroll={() => {
          if (hoveredIndex === null) return;
          const button = tickRefs.current[hoveredIndex];
          if (button) updateTooltipPosition(hoveredIndex, button);
        }}
      >
        {entries.map((entry, index) => {
          const active = entry.id === activeId;
          const width = railWidth(index, hoveredIndex);
          const waveDistance = hoveredIndex === null ? null : Math.abs(index - hoveredIndex);
          const emphasized = active || (waveDistance !== null && waveDistance <= 2);
          return (
            <button
              ref={(node) => { tickRefs.current[index] = node; }}
              key={entry.id}
              type="button"
              aria-current={active ? 'location' : undefined}
              aria-label={itemLabel(index + 1, entry.preview)}
              title={entry.preview}
              className="conversation-index-tick group focus-visible:outline-none"
              style={{ width }}
              onMouseEnter={(event) => updateTooltipPosition(index, event.currentTarget)}
              onFocus={(event) => updateTooltipPosition(index, event.currentTarget)}
              onBlur={clearPreview}
              onClick={() => onSelect(entry.id)}
            >
              <span
                aria-hidden="true"
                className={`conversation-index-tick-line ${emphasized ? 'conversation-index-tick-line-emphasized' : ''}`}
              />
            </button>
          );
        })}
      </div>
      {previewIndex !== null ? (
        <div
          role="tooltip"
          className="conversation-index-tooltip"
          style={{ top: tooltipTop ?? 0 }}
        >
          <span className="conversation-index-tooltip-number">{previewIndex + 1}</span>
          <span className="conversation-index-tooltip-copy">
            <span
              data-testid="conversation-index-prompt-preview"
              className="conversation-index-tooltip-prompt truncate"
            >
              {entries[previewIndex]?.preview}
            </span>
            {entries[previewIndex]?.responsePreview ? (
              <span
                data-testid="conversation-index-response-preview"
                className="conversation-index-tooltip-response line-clamp-2"
              >
                {entries[previewIndex]?.responsePreview}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </nav>
  );
}
