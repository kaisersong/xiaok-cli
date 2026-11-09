import { useParams } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';
import { ContextReferenceCard } from './ContextReference';
import { parseContextLink } from '../../../shared/context-continuity-types';

export function ContextReferenceLanding() {
  const { refId } = useParams(), { t } = useLocale();
  const url = `xiaok://context/v1/${refId ?? ''}`;
  return <div className="flex-1 overflow-auto p-6 text-[var(--c-text-primary)]"><h1 className="text-lg font-medium">{t.contextContinuity.reference}</h1>
    <p className="my-3 text-sm text-[var(--c-text-secondary)]">{t.contextContinuity.navigationNotice}</p>
    {parseContextLink(url) ? <ContextReferenceCard url={url} /> : <p role="alert">{t.contextContinuity.unavailable}</p>}
  </div>;
}
