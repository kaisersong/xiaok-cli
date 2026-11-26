import { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  SlidersHorizontal,
  Loader2,
  Plug,
  Puzzle,
  Info,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { api } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, Card, btnPrimary, btnSecondary } from './settings-ui';

// ---- About ----

export function AboutPane() {
  const { t } = useLocale();
  const [updateStatus, setUpdateStatus] = useState<{ checking: boolean; available: boolean; downloading: boolean; downloaded: boolean; installing?: boolean; progress: number; version?: string; error?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateReadError, setUpdateReadError] = useState('');
  const updateGeneration = useRef(0);
  const readUpdateFacts = async () => {
    const generation = ++updateGeneration.current;
    try {
      const next = await api.getUpdateStatus();
      if (generation === updateGeneration.current) { setUpdateStatus(next); setUpdateReadError(''); }
    } catch {
      if (generation === updateGeneration.current) setUpdateReadError(t.desktopSettings.updaterProjectionUnavailable);
    }
  };
  useEffect(() => {
    const unsub = api.onUpdateStatus(status => { ++updateGeneration.current; setUpdateStatus(status); setUpdateReadError(''); });
    void readUpdateFacts();
    return () => { ++updateGeneration.current; unsub(); };
    // The subscription belongs to this mounted pane; explicit refresh reads current facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleCheckUpdate = async () => {
    ++updateGeneration.current;
    setChecking(true);
    try { await api.checkForUpdates(); await readUpdateFacts(); }
    catch { setUpdateReadError(t.desktopSettings.updaterOperationUnknown); }
    finally { setChecking(false); }
  };
  const handleInstallUpdate = async () => {
    ++updateGeneration.current;
    try {
      const result = await api.quitAndInstall();
      if (result?.status === 'rejected_sync' || result?.status === 'pending_error_sticky') setUpdateReadError(t.sidebarUpdateHandoffUnconfirmedHint);
      else if (!result || !['pending', 'already_pending', 'already_handed_off'].includes(result.status)) setUpdateReadError(t.desktopSettings.updaterOperationUnknown);
    } catch { setUpdateReadError(t.desktopSettings.updaterOperationUnknown); }
  };

  return (
    <>
      <Section>
        <SectionHeader icon={Info}>{t.desktopSettings.aboutTitle}</SectionHeader>
        <Card>
          <div className="text-sm">
            <div className="font-medium text-base">xiaok desktop</div>
            <div className="text-xs text-[var(--c-text-secondary)] mt-2">
              {t.desktopSettings.aboutLocalMode}
            </div>
            <div className="text-xs text-[var(--c-text-tertiary)] mt-3">
              {t.desktopSettings.aboutAppDesc}
            </div>
            <a
              href="https://github.com/kaisersong"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--c-accent)] hover:underline mt-3"
            >
              github.com/kaisersong
              <ExternalLink size={11} />
            </a>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Zap}>{t.desktopSettings.softwareUpdate}</SectionHeader>
        <Card>
          {updateReadError && <div role="alert" className="mb-3 text-sm text-red-500"><p>{updateReadError}</p><button type="button" onClick={() => void readUpdateFacts()} className={btnSecondary}>{t.desktopSettings.updaterRefreshData}</button></div>}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {updateReadError && !updateStatus ? t.desktopSettings.updaterProjectionUnavailable : updateStatus?.error && updateStatus.downloaded ? t.sidebarUpdateHandoffUnconfirmed : updateStatus?.installing ? t.desktopSettings.aboutInstalling : updateStatus?.downloaded ? t.desktopSettings.aboutUpdateReady : updateStatus?.downloading ? t.desktopSettings.aboutDownloading : updateStatus?.available ? t.desktopSettings.aboutNewVersion : t.desktopSettings.aboutCurrentVersion}
              </div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {updateStatus?.error && updateStatus.downloaded ? t.sidebarUpdateHandoffUnconfirmedHint :
                 updateStatus?.installing ? t.desktopSettings.aboutInstallingVersion(updateStatus.version || '') :
                 updateStatus?.downloaded ? t.desktopSettings.aboutDownloadedVersion(updateStatus.version || '') :
                 updateStatus?.downloading ? t.desktopSettings.aboutDownloadProgress(updateStatus.progress) :
                 updateStatus?.available ? t.desktopSettings.aboutVersionAvailable(updateStatus.version || '') :
                 updateStatus?.checking || checking ? t.desktopSettings.aboutChecking :
                 `v${__APP_VERSION__}`}
              </div>
              {updateStatus?.error && updateStatus.error !== 'update_install_handoff_unconfirmed' && (
                <div className="text-xs text-red-500 mt-1">{updateStatus.error === 'update_install_handoff_unconfirmed' ? t.sidebarUpdateHandoffUnconfirmedHint : updateStatus.error === 'update_install_not_ready' ? t.sidebarUpdateInstallNotReady : t.desktopSettings.updaterOperationUnknown}</div>
              )}
            </div>
            <div className="flex gap-2">
              {updateStatus?.error && updateStatus.downloaded ? (
                <a href="https://github.com/kaisersong/xiaok-cli/releases/latest" target="_blank" rel="noopener noreferrer" className={btnPrimary}>{t.sidebarUpdateGoToGithub}</a>
              ) : updateStatus?.downloaded ? (
                <button type="button" onClick={handleInstallUpdate} disabled={updateStatus.installing} className={btnPrimary}>
                  {updateStatus.installing ? t.desktopSettings.aboutInstallProgress : t.desktopSettings.aboutInstallRestart}
                </button>
              ) : updateStatus?.downloading ? (
                <div className="flex items-center gap-2 text-[var(--c-accent)]">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">{updateStatus.progress}%</span>
                </div>
              ) : (
                <button type="button" onClick={handleCheckUpdate} disabled={checking || updateStatus?.checking} className={btnSecondary}>
                  {checking || updateStatus?.checking ? t.desktopSettings.aboutCheckingUpdates : t.desktopSettings.aboutCheckUpdates}
                </button>
              )}
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Cpu}>{t.desktopSettings.coreFeatures}</SectionHeader>
        <div className="flex flex-col gap-2">
          <Card>
            <div className="flex items-start gap-3">
              <Zap size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureIntentRecognition}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureIntentRecognitionDesc}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <SlidersHorizontal size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureToolCalling}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureToolCallingDesc}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <Puzzle size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureSkillExtension}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureSkillExtensionDesc}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <Plug size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureMcp}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureMcpDesc}</div>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      <Section>
        <SectionHeader>{t.desktopSettings.supportedProviders}</SectionHeader>
        <Card>
          <div className="flex flex-wrap gap-2">
            {['OpenAI', 'Anthropic', 'DeepSeek', 'Kimi', 'GLM', 'MiniMax', 'Gemini'].map(name => (
              <span key={name} className="rounded-md px-2.5 py-1 text-xs bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]">
                {name}
              </span>
            ))}
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader>{t.desktopSettings.versionInfo}</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)]">
            <div>{t.desktopSettings.versionLabel}: v{__APP_VERSION__} ({__APP_BUILD__})</div>
            <div className="mt-1">{t.desktopSettings.buildLabel}: Electron + React</div>
          </div>
        </Card>
      </Section>
    </>
  );
}
