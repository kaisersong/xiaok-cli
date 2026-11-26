import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu,
  SlidersHorizontal,
  Loader2,
  Info,
  Zap,
  Camera,
  User,
  Server,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../api';
import { LocalExecutionAuthorizationCard } from './LocalExecutionAuthorizationCard';
import type { DesktopRelatedServiceId, DesktopRelatedServiceStatus, DesktopServiceStatusSnapshot } from '../../../../electron/preload-api';
import { useLocale } from '../../contexts/LocaleContext';
import { WriterControlSection } from '../WriterControlSection';
import { SectionHeader, Section, Card, btnSecondary } from './settings-ui';

// ---- General ----

export function GeneralPane() {
  const { locale, setLocale, t } = useLocale();
  const [skillDebug, setSkillDebug] = useState(false);
  const [savingSkillDebug, setSavingSkillDebug] = useState(false);
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(3);
  const [savingConcurrency, setSavingConcurrency] = useState(false);
  const skillConfigSequence = useRef(0);
  const concurrencyConfigSequence = useRef(0);
  const [skillConfigError, setSkillConfigError] = useState<'' | 'load' | 'unknown' | 'save'>('');
  const [concurrencyConfigError, setConcurrencyConfigError] = useState<'' | 'load' | 'unknown' | 'save'>('');
  const [serviceStatus, setServiceStatus] = useState<DesktopServiceStatusSnapshot | null>(null);
  const [serviceStatusLoading, setServiceStatusLoading] = useState(true);
  const [serviceReadUnavailable, setServiceReadUnavailable] = useState(false);
  const [serviceActionUnknown, setServiceActionUnknown] = useState(false);
  const serviceReadLifetime = useRef<{ active: boolean; busy: boolean; queued: boolean } | null>(null);
  const serviceActionLifetime = useRef<{ active: boolean; busy: boolean } | null>(null);
  const [restartingService, setRestartingService] = useState<DesktopRelatedServiceId | null>(null);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('xiaok_display_name') || '');
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem('xiaok_avatar_url') || '');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const loadServiceStatus = useCallback(async (mode: 'initial' | 'poll' | 'manual' = 'manual'): Promise<void> => {
    const lifetime = serviceReadLifetime.current;
    if (!lifetime?.active) return;
    if (lifetime.busy) {
      if (mode === 'manual') { lifetime.queued = true; setServiceStatusLoading(true); }
      return;
    }
    lifetime.busy = true;
    if (mode !== 'poll') setServiceStatusLoading(true);
    try {
      do {
        lifetime.queued = false;
        try {
          const snapshot = await api.getServiceStatus();
          if (lifetime.active) { setServiceStatus(snapshot); setServiceReadUnavailable(false); }
        } catch {
          if (lifetime.active) setServiceReadUnavailable(true);
        }
      } while (lifetime.active && lifetime.queued);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setServiceStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const lifetime = { active: true, busy: false };
    serviceActionLifetime.current = lifetime;
    return () => {
      lifetime.active = false;
      if (serviceActionLifetime.current === lifetime) serviceActionLifetime.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const sequence = ++skillConfigSequence.current;
    api.getSkillDebugConfig().then(c => {
      if (active && sequence === skillConfigSequence.current) setSkillDebug(c.enabled);
    }).catch(() => {
      if (active && sequence === skillConfigSequence.current) setSkillConfigError('load');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const lifetime = { active: true, busy: false, queued: false };
    serviceReadLifetime.current = lifetime;
    void loadServiceStatus('initial');
    const timer = window.setInterval(() => { void loadServiceStatus('poll'); }, 10_000);
    return () => {
      lifetime.active = false;
      lifetime.queued = false;
      if (serviceReadLifetime.current === lifetime) serviceReadLifetime.current = null;
      window.clearInterval(timer);
    };
  }, [loadServiceStatus, t.desktopSettings.serviceStatusLoadError]);

  const handleSkillDebugToggle = async (enabled: boolean) => {
    const sequence = ++skillConfigSequence.current;
    setSkillConfigError('');
    setSavingSkillDebug(true);
    try {
      const saved = await api.saveSkillDebugConfig({ enabled });
      if (sequence === skillConfigSequence.current) setSkillDebug(saved.enabled);
    } catch (error) {
      if (sequence === skillConfigSequence.current) setSkillConfigError(
        error instanceof Error && (error.message === 'desktop_config_operation_unknown' || error.message.endsWith(': desktop_config_operation_unknown'))
          ? 'unknown' : 'save');
    } finally {
      if (sequence === skillConfigSequence.current) setSavingSkillDebug(false);
    }
  };

  useEffect(() => {
    let active = true;
    const sequence = ++concurrencyConfigSequence.current;
    api.getKswarmConfig().then(c => {
      if (active && sequence === concurrencyConfigSequence.current) setMaxConcurrentTasks(c.maxConcurrentTasks);
    }).catch(() => {
      if (active && sequence === concurrencyConfigSequence.current) setConcurrencyConfigError('load');
    });
    return () => { active = false; };
  }, []);

  const handleConcurrencyChange = async (value: number) => {
    const clamped = Math.max(1, Math.min(10, value));
    const sequence = ++concurrencyConfigSequence.current;
    setConcurrencyConfigError('');
    setSavingConcurrency(true);
    try {
      const saved = await api.saveKswarmConfig({ maxConcurrentTasks: clamped });
      if (sequence === concurrencyConfigSequence.current) setMaxConcurrentTasks(saved.maxConcurrentTasks);
    } catch (error) {
      if (sequence === concurrencyConfigSequence.current) setConcurrencyConfigError(
        error instanceof Error && (error.message === 'desktop_config_operation_unknown' || error.message.endsWith(': desktop_config_operation_unknown'))
          ? 'unknown' : 'save');
    } finally {
      if (sequence === concurrencyConfigSequence.current) setSavingConcurrency(false);
    }
  };

  const handleRestartService = async (serviceId: DesktopRelatedServiceId) => {
    const lifetime = serviceActionLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    setRestartingService(serviceId);
    setServiceActionUnknown(false);
    try {
      await api.restartRelatedService(serviceId);
      if (lifetime.active) await loadServiceStatus('manual');
    } catch {
      if (lifetime.active) setServiceActionUnknown(true);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setRestartingService(null);
    }
  };

  const handleStartEditName = () => {
    setNameInput(displayName);
    setEditingName(true);
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      localStorage.setItem('xiaok_display_name', trimmed);
    } else {
      localStorage.removeItem('xiaok_display_name');
    }
    setDisplayName(trimmed);
    setEditingName(false);
    window.dispatchEvent(new Event('xiaok-profile-changed'));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height, 128);
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        if (dataUrl.length > 140000) {
          alert(t.desktopSettings.avatarTooLarge);
          return;
        }
        localStorage.setItem('xiaok_avatar_url', dataUrl);
        setAvatarUrl(dataUrl);
        window.dispatchEvent(new Event('xiaok-profile-changed'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const initial = (displayName || '?').charAt(0).toUpperCase();

  return (
    <>
      <Section>
        <SectionHeader icon={User}>{t.desktopSettings.profileTitle}</SectionHeader>
        <Card>
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="size-12 rounded-full object-cover" />
              ) : (
                <div
                  className="flex size-12 items-center justify-center rounded-full text-base font-semibold"
                  style={{ background: 'var(--c-avatar-bg, #e2e8f0)', color: 'var(--c-avatar-text, #475569)' }}
                >
                  {initial}
                </div>
              )}
              <label className="absolute -bottom-0.5 -right-0.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-[var(--c-bg-card)] shadow" title={t.desktopSettings.changeAvatar}>
                <Camera size={10} />
                <input aria-label={t.desktopSettings.changeAvatar} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </label>
            </div>
            {/* Name */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input aria-label={t.desktopSettings.enterYourName}
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                    className="min-w-0 flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                    placeholder={t.desktopSettings.enterYourName}
                    autoFocus
                  />
                  <button type="button" onClick={handleSaveName} className="text-xs text-[var(--c-accent)]">{t.desktopSettings.save}</button>
                  <button type="button" onClick={() => setEditingName(false)} className="text-xs text-[var(--c-text-tertiary)]">{t.desktopSettings.cancelAction}</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStartEditName}
                  className="truncate text-left text-sm font-medium text-[var(--c-text-heading)] hover:text-[var(--c-accent)]"
                >
                  {displayName || t.desktopSettings.clickToSetName}
                </button>
              )}
              <span className="text-xs text-[var(--c-text-tertiary)]">{t.desktopSettings.nameCallHint}</span>
            </div>
          </div>
        </Card>
      </Section>
      <Section>
        <SectionHeader icon={SlidersHorizontal}>{t.desktopSettings.languageTitle}</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {t.desktopSettings.languageDesc}
          </p>
          <div className="flex gap-3">
            <button type="button"
              onClick={() => setLocale('zh')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm transition-colors border ${
                locale === 'zh'
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border-[var(--c-accent)]/30'
                  : 'border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              <div className="font-medium">{t.desktopSettings.langZh}</div>
              <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">{t.desktopSettings.langZhSub}</div>
            </button>
            <button type="button"
              onClick={() => setLocale('en')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm transition-colors border ${
                locale === 'en'
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border-[var(--c-accent)]/30'
                  : 'border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              <div className="font-medium">{t.desktopSettings.langEn}</div>
              <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">{t.desktopSettings.langEnSub}</div>
            </button>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Server}>{t.desktopSettings.serviceStatusTitle}</SectionHeader>
        <Card>
          <div className="flex flex-col gap-3">
            {serviceStatusLoading && !serviceStatus ? (
              <div className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
                <Loader2 size={14} className="animate-spin" />
                <span>{t.desktopSettings.serviceStatusChecking}</span>
              </div>
            ) : null}
            {serviceStatus?.services.map(service => (
              <ServiceStatusRow
                key={service.id}
                service={service}
                restarting={restartingService === service.id}
                disabled={restartingService !== null}
                onRestart={handleRestartService}
              />
            ))}
            {serviceReadUnavailable || serviceActionUnknown ? (
              <div role="alert" className="rounded-md border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
                {serviceReadUnavailable && <div>{t.desktopSettings.serviceStatusLoadError}</div>}
                {serviceActionUnknown && <div>{t.desktopSettings.serviceRestartUnknown}</div>}
              </div>
            ) : null}
            <button type="button" onClick={() => void loadServiceStatus('manual')} className={`${btnSecondary} self-start`}>
              {serviceStatusLoading ? <Loader2 size={13} className="mr-1 inline animate-spin" aria-hidden="true" /> : null}
              {t.desktopSettings.serviceStatusReadRetry}
            </button>
          </div>
        </Card>
      </Section>

      <Section>
        <WriterControlSection />
      </Section>

      <Section>
        <SectionHeader icon={Cpu}>{t.desktopSettings.taskConcurrencyTitle}</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {t.desktopSettings.taskConcurrencyDesc}
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              aria-label={t.desktopSettings.taskConcurrencyAria}
              min={1}
              max={10}
              step={1}
              value={maxConcurrentTasks}
              disabled={savingConcurrency}
              onChange={(e) => handleConcurrencyChange(Number(e.target.value))}
              className="flex-1 accent-[var(--c-accent)]"
            />
            <span className="min-w-[2.5rem] text-center text-sm font-medium text-[var(--c-text-heading)]">
              {maxConcurrentTasks}
            </span>
            {savingConcurrency && <Loader2 size={14} className="animate-spin text-[var(--c-text-tertiary)]" />}
          </div>
          {concurrencyConfigError ? <div role="alert" className="mt-2 text-xs text-[var(--c-status-error-text)]">{concurrencyConfigError === 'load' ? t.desktopSettings.configLoadFailed : concurrencyConfigError === 'unknown' ? t.desktopSettings.configOperationUnknown : t.desktopSettings.configSaveFailed}</div> : null}
          <div className="mt-2 flex justify-between text-[10px] text-[var(--c-text-tertiary)]">
            <span>{t.desktopSettings.taskConcurrencyMin}</span>
            <span>{t.desktopSettings.taskConcurrencyMax}</span>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Zap}>{t.desktopSettings.stageDebugTitle}</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {t.desktopSettings.stageDebugDesc}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {savingSkillDebug && <Loader2 size={16} className="animate-spin text-[var(--c-text-tertiary)]" />}
              <span className="text-sm text-[var(--c-text-primary)]">
                {skillDebug ? t.desktopSettings.stageDebugOn : t.desktopSettings.stageDebugOff}
              </span>
            </div>
            <button type="button"
              aria-label={t.desktopSettings.stageDebugToggleAria}
              disabled={savingSkillDebug}
              onClick={() => handleSkillDebugToggle(!skillDebug)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                skillDebug ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border)]'
              }`}
            >
              <span
                className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                  skillDebug ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {skillConfigError ? <div role="alert" className="mt-2 text-xs text-[var(--c-status-error-text)]">{skillConfigError === 'load' ? t.desktopSettings.configLoadFailed : skillConfigError === 'unknown' ? t.desktopSettings.configOperationUnknown : t.desktopSettings.configSaveFailed}</div> : null}
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Info}>{t.desktopSettings.appInfoTitle}</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)] space-y-1">
            <div>{t.desktopSettings.appInfoVersion} v{__APP_VERSION__} ({__APP_BUILD__})</div>
            <div>{t.desktopSettings.appInfoBuild}</div>
            <div>{t.desktopSettings.appInfoDataPath}</div>
          </div>
        </Card>
      </Section>
      <LocalExecutionAuthorizationCard />
    </>
  );
}

function ServiceStatusRow({
  service,
  restarting,
  disabled,
  onRestart,
}: {
  service: DesktopRelatedServiceStatus;
  restarting: boolean;
  disabled: boolean;
  onRestart: (serviceId: DesktopRelatedServiceId) => void;
}) {
  const { t } = useLocale();
  const status = getRelatedServiceDisplayStatus(service, t);
  const meta = [
    `:${service.port}`,
    service.pid ? `PID ${service.pid}` : '',
    service.restartCount ? `${t.desktopSettings.serviceRestartCount} ${service.restartCount}` : '',
    service.detail || '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--c-border)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`size-2.5 shrink-0 rounded-full ${status.dotClass}`} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--c-text-primary)]">{service.label}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${status.badgeClass}`}>
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-[var(--c-text-tertiary)]">{meta}</div>
          {service.lastError ? (
            <div className="mt-1 truncate text-xs text-[var(--c-status-error-text)]">{service.lastError}</div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        aria-label={`restart-service-${service.id}`}
        title={`${service.label} ${t.desktopSettings.serviceRestart}`}
        onClick={() => onRestart(service.id)}
        disabled={disabled || restarting}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--c-border)] px-2.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {restarting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        <span>{t.desktopSettings.serviceRestart}</span>
      </button>
    </div>
  );
}

function getRelatedServiceDisplayStatus(service: DesktopRelatedServiceStatus, t: ReturnType<typeof useLocale>['t']): {
  label: string;
  dotClass: string;
  badgeClass: string;
} {
  if (service.reachable && service.running) {
    return {
      label: t.desktopSettings.serviceStatusRunning,
      dotClass: 'bg-[var(--c-status-success-text,#16a34a)]',
      badgeClass: 'bg-[var(--c-status-ok-bg,#dcfce7)] text-[var(--c-status-ok-text,#166534)]',
    };
  }
  if (service.running) {
    return {
      label: t.desktopSettings.serviceStatusAbnormal,
      dotClass: 'bg-[var(--c-status-warning-text,#d97706)]',
      badgeClass: 'bg-[var(--c-status-warning-bg,#fef3c7)] text-[var(--c-status-warning-text,#92400e)]',
    };
  }
  return {
    label: t.desktopSettings.serviceStatusUnavailable,
    dotClass: 'bg-[var(--c-status-error-text,#dc2626)]',
    badgeClass: 'bg-[var(--c-status-error-bg,#fee2e2)] text-[var(--c-status-error-text,#991b1b)]',
  };
}
