import { useLocale } from '../../contexts/LocaleContext';
import { YzjCliAuthCard } from './YzjCliAuthCard';

export function AppConnectorsSettings() {
  const { t } = useLocale();
  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--c-text-primary)]">{t.nav.connectors}</h2>
      <p className="mb-6 mt-2 text-sm text-[var(--c-text-secondary)]">{t.desktopSettings.appConnectorsDesc}</p>
      <YzjCliAuthCard />
    </div>
  );
}
