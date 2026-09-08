import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MultiAgentReadContent } from '../lib/multi-agent-content-reader';
import type { LocaleStrings } from '../locales';

const SEGMENT_UNITS = 8192;

function segmentOffsets(text: string): number[] {
  const offsets = [0];
  while (offsets[offsets.length - 1] < text.length) {
    let end = Math.min(offsets[offsets.length - 1] + SEGMENT_UNITS, text.length);
    const before = text.charCodeAt(end - 1); const after = text.charCodeAt(end);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
    offsets.push(end);
  }
  if (offsets.length === 1) offsets.push(0);
  return offsets;
}

interface Props {
  result: MultiAgentReadContent;
  labels: LocaleStrings['multiAgent'];
  onOwnedPagerRemoved: () => void;
}

// This is a view of an already fully verified result, never a content reader or
// a cache. Only offsets and one slice are derived; no hidden full-text DOM.
export function SavedAgentContent({ result, labels, onOwnedPagerRemoved }: Props) {
  const offsets = useMemo(() => segmentOffsets(result.text), [result.text]);
  const [page, setPage] = useState({ result, index: 0 });
  const index = page.result === result ? page.index : 0;
  const count = offsets.length - 1;
  const owner = useRef<MultiAgentReadContent | null>(result);
  const previousButton = useRef<HTMLButtonElement | null>(null); const nextButton = useRef<HTMLButtonElement | null>(null);
  const pager = useRef<HTMLDivElement>(null);
  const bindPrevious = useCallback((node: HTMLButtonElement | null) => {
    if (!node && previousButton.current === document.activeElement) onOwnedPagerRemoved();
    previousButton.current = node;
  }, [onOwnedPagerRemoved]);
  const bindNext = useCallback((node: HTMLButtonElement | null) => {
    if (!node && nextButton.current === document.activeElement) onOwnedPagerRemoved();
    nextButton.current = node;
  }, [onOwnedPagerRemoved]);
  useLayoutEffect(() => { owner.current = result; return () => { owner.current = null; }; }, [result]);
  const move = (delta: number) => {
    if (owner.current !== result || index + delta < 0 || index + delta >= count) return;
    setPage(previous => {
      if (owner.current !== result) return previous;
      const current = previous.result === result ? previous.index : 0;
      const next = current + delta;
      return next < 0 || next >= count ? previous : { result, index: next };
    });
    // Scroll only this existing output scroller. scrollIntoView would also move
    // the outer chat/window and can hide or steal the user's composer context.
    const container = pager.current?.closest<HTMLElement>('.multi-agent-output');
    const heading = pager.current?.closest<HTMLElement>('.multi-agent-saved-content');
    if (container && heading) {
      // Keep the storage-loss warning visible too, not only the pager below it.
      container.scrollTop += heading.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }
  };
  return <div className="multi-agent-saved-content">
    {result.truncated ? <p role="status">{labels.savedContentTruncated(result.byteLength)}</p> : null}
    {count > 1 ? <>
      <p>{labels.contentSegmented}</p>
      <div ref={pager} className="multi-agent-actions multi-agent-content-pager">
        <button ref={bindPrevious} type="button" aria-disabled={index === 0} onClick={() => move(-1)}>{labels.previousContentSegment}</button>
        <span role="status">{labels.contentSegment(index + 1, count)}</span>
        <button ref={bindNext} type="button" aria-disabled={index === count - 1} onClick={() => move(1)}>{labels.nextContentSegment}</button>
      </div>
    </> : null}
    <pre>{result.text.slice(offsets[index], offsets[index + 1])}</pre>
  </div>;
}
