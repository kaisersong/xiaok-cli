import { MessageSquare, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../../contexts/LocaleContext';
export interface RoomCardData {
    roomId: string;
    title: string;
    description: string;
    memberCount: number;
}
export function RoomInlineCard({ roomId, title, description, memberCount }: RoomCardData) {
    const navigate = useNavigate();
    const { t } = useLocale();
    return <button type="button" aria-label={title} onClick={() => navigate(`/collaboration/${roomId}`)} className="cursor-pointer max-w-md rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-4 text-left hover:bg-[var(--c-bg-deep)]">
  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--c-text-heading)]"><MessageSquare size={16}/>{title}<ArrowRight size={14}/></span>
  <span className="mb-2 block text-xs text-[var(--c-text-secondary)] line-clamp-2">{description}</span>
  <span className="text-xs text-[var(--c-text-muted)]">{t.collaborationRoomsTitle} · {t.projectsInlineAgentCount(memberCount)}</span>
 </button>;
}
