import { useState } from 'react';
import { Database, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, Card, btnDanger } from './settings-ui';

// ---- Data ----

export function DataPane() {
  const { t } = useLocale();
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    if (!confirm(t.desktopSettings.clearDataConfirm)) return;
    setClearing(true);
    try {
      // Clear IndexedDB
      const dbReq = indexedDB.deleteDatabase('xiaok-desktop');
      dbReq.onsuccess = () => {
        // Clear localStorage
        localStorage.clear();
        alert(t.desktopSettings.dataCleared);
        window.location.reload();
      };
      dbReq.onerror = () => {
        alert(t.desktopSettings.clearFailed(dbReq.error?.message ?? ''));
        setClearing(false);
      };
    } catch (e) {
      alert((e as Error).message);
      setClearing(false);
    }
  };

  return (
    <>
      <Section>
        <SectionHeader icon={Database}>{t.desktopSettings.localData}</SectionHeader>
        <Card>
          <div className="flex items-start gap-3">
            <Database size={18} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium">{t.desktopSettings.dataStorageLocation}</div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {t.desktopSettings.dataStorageIndexedDb}<br />
                {t.desktopSettings.dataStorageLocalStorage}
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={SlidersHorizontal}>{t.desktopSettings.configPath}</SectionHeader>
        <Card>
          <code className="text-sm font-mono text-[var(--c-text-secondary)]">
            ~/.xiaok/config.json
          </code>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Trash2}>{t.desktopSettings.dangerZone}</SectionHeader>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t.desktopSettings.clearAllData}</div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {t.desktopSettings.clearAllDataDesc}
              </div>
            </div>
            <button type="button"
              onClick={handleClear}
              disabled={clearing}
              className={btnDanger}
            >
              {clearing ? t.desktopSettings.clearing : t.desktopSettings.clearData}
            </button>
          </div>
        </Card>
      </Section>
    </>
  );
}
