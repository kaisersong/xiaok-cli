import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';

export function RoomMessageList({ revision, children }: { revision: unknown; children: ReactNode }) {
  const { t } = useLocale();
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && following.current) scroller.scrollTop = scroller.scrollHeight;
  }, [revision]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (following.current) scroller.scrollTop = scroller.scrollHeight;
      else if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50) {
        following.current = true;
        setShowJump(false);
      }
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  return <>
    <section ref={scrollRef} onScroll={() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      following.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50;
      setShowJump(!following.current);
    }} className="min-h-0 flex-1 overflow-y-auto px-6 py-5" data-testid="room-message-scroll">
      <div ref={contentRef}>{children}</div>
    </section>
    {showJump && <div className="relative mx-auto w-full max-w-3xl shrink-0">
      <button type="button" aria-label={t.chatView.scrollToBottom} title={t.chatView.scrollToBottom} onClick={() => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        following.current = true;
        setShowJump(false);
        if (scroller.scrollTo) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        else scroller.scrollTop = scroller.scrollHeight;
      }} className="absolute -top-12 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--c-border)] bg-[var(--c-bg)] shadow-lg transition-colors hover:bg-[var(--c-bg-sub)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]">
        <ChevronDown size={16} className="text-[var(--c-text-secondary)]" />
      </button>
    </div>}
  </>;
}
