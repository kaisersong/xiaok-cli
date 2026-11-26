import { useSkillListReadonly, useSkillStatsReadonly } from '../../hooks/useSkillReadonly';
import { useState } from 'react';
import {
  Loader2,
  Check,
  X,
  Puzzle,
  Trash2,
  Plus,
  AlertCircle,
  Info,
  Package,
} from 'lucide-react';
import { api } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, Card, inputCls, btnPrimary, btnSecondary } from './settings-ui';

interface SkillItem {
  name: string;
  aliases: string[];
  description: string;
  source: string;
  tier: string;
}

export function SkillsPane() {
  const { t } = useLocale();
  const listFacts = useSkillListReadonly(), statFacts = useSkillStatsReadonly();
  const skills = listFacts.data ?? [];
  const loading = listFacts.reading && listFacts.data === null;
  const [installing, setInstalling] = useState(false);
  const [installName, setInstallName] = useState('');
  const [showInstall, setShowInstall] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const statsMap = new Map((statFacts.data ?? []).map(s => [s.skillName, s]));

  const handleInstall = async () => {
    if (!installName.trim()) return;
    setInstalling(true);
    setError('');
    try {
      const result = await api.installSkill(installName.trim());
      if (result.success) {
        setSuccess(result.message);
        setShowInstall(false);
        setInstallName('');
        // Refresh skill list
        listFacts.refresh();
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (skillName: string) => {
    if (!confirm(t.desktopSettings.confirmUninstallSkill(skillName))) return;
    setInstalling(true);
    setError('');
    try {
      const result = await api.uninstallSkill(skillName);
      if (result.success) {
        setSuccess(result.message);
        // Refresh skill list
        listFacts.refresh();
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  if (loading && !listFacts.failed) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  return (
    <>
      {listFacts.failed && <p role="alert">{t.skillsReadonlyListFailed}</p>}
      {statFacts.failed && <p role="alert">{t.skillsReadonlyStatsFailed}</p>}
      <button type="button" onClick={() => { listFacts.refresh(); statFacts.refresh(); }}>{t.skillsReadonlyRetry}</button>
      <Section>
        <SectionHeader icon={Puzzle}>{listFacts.data === null ? t.skillsReadonlyUnknown : t.desktopSettings.installedSkills(skills.length)}</SectionHeader>
        {/* Status messages */}
        {success && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">
            <Check size={16} />
            {success}
            <button type="button" onClick={() => setSuccess('')} className="ml-auto text-green-600 hover:text-green-700">
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={16} />
            {error}
            <button type="button" onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          {t.desktopSettings.skillsDesc}
        </p>

        {/* Install button */}
        <button type="button"
          onClick={() => setShowInstall(!showInstall)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          {t.desktopSettings.installSkill}
        </button>

        {/* Install form */}
        {showInstall && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-install-skill-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">{t.desktopSettings.skillName}</label>
                <input
                  id="desktop-install-skill-name"
                  type="text"
                  value={installName}
                  onChange={e => setInstallName(e.target.value)}
                  placeholder={t.desktopSettings.skillNamePlaceholder}
                  className={inputCls}
                />
              </div>
              <div className="text-xs text-[var(--c-text-secondary)]">
                {t.desktopSettings.installCommand} <code className="bg-[var(--c-bg-deep)] px-1.5 py-0.5 rounded">clawhub install {installName || `<${t.desktopSettings.skillNameExample}>`}</code>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleInstall} disabled={installing || !installName.trim()} className={btnPrimary}>
                  {installing ? t.desktopSettings.installing : t.desktopSettings.confirmInstall}
                </button>
                <button type="button" onClick={() => setShowInstall(false)} className={btnSecondary}>{t.desktopSettings.cancelLabel}</button>
              </div>
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {listFacts.data !== null && skills.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                {t.desktopSettings.noInstalledSkills} <code className="bg-[var(--c-bg-deep)] px-1.5 py-0.5 rounded">clawhub install &lt;{t.desktopSettings.skillNameExample}&gt;</code> {t.desktopSettings.noInstalledSkillsHint}
              </div>
            </Card>
          ) : (
            skills
              .slice()
              .sort((a, b) => {
                const sa = statsMap.get(a.name);
                const sb = statsMap.get(b.name);
                const ca = sa?.totalCalls ?? 0;
                const cb = sb?.totalCalls ?? 0;
                return cb - ca;
              })
              .map(skill => {
              const stats = statsMap.get(skill.name);
              return (
                <Card key={skill.name}>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                      <Package size={16} className="text-[var(--c-accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-[var(--c-accent)]">/{skill.name}</code>
                        <span className="text-xs text-[var(--c-text-tertiary)]">[{skill.tier}]</span>
                        {stats && stats.totalCalls > 0 && (
                          <span className="ml-auto text-xs text-[var(--c-text-tertiary)]">
                            {Number.isFinite(stats.avgDurationMs) ? t.desktopSettings.skillStats(stats.totalCalls, Math.round(stats.avgDurationMs / 1000)) : t.skillsReadonlyMetricUnknown}
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="mt-1 text-sm text-[var(--c-text-secondary)] line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                      {skill.aliases && skill.aliases.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {skill.aliases.map(a => (
                            <span key={a} className="rounded px-1.5 py-0.5 text-xs bg-[var(--c-bg-deep)] text-[var(--c-text-tertiary)]">
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button"
                      onClick={() => handleUninstall(skill.name)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 transition-colors"
                      title={t.desktopSettings.uninstall}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </Section>

      <Section>
        <SectionHeader>{t.desktopSettings.skillSources}</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)]">
            {t.desktopSettings.skillSourcesDesc}
            <div className="mt-2 flex flex-col gap-1 font-mono">
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub search &lt;{t.desktopSettings.skillSourcesSearch}&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub install &lt;{t.desktopSettings.skillSourcesInstall}&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub uninstall &lt;{t.desktopSettings.skillSourcesUninstall}&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub list</code>
            </div>
          </div>
        </Card>
      </Section>
    </>
  );
}
