import { useState, useEffect, useCallback, useRef } from 'react';
import * as QRCode from 'qrcode';
import { Loader2, Copy, RefreshCw, Smartphone, QrCode } from 'lucide-react';
import { api } from '../../api';
import type { DesktopMobilePairingInfo, DesktopMobileRelayStatus } from '../../../../electron/preload-api';
import { useLocale } from '../../contexts/LocaleContext';
import { SectionHeader, Section, Card, btnSecondary } from './settings-ui';

export function MobilePane() {
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<{ pairing: DesktopMobilePairingInfo; qrDataUrl: string } | null>(null);
  const pairing = snapshot?.pairing ?? null;
  const qrDataUrl = snapshot?.qrDataUrl ?? '';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const pairingLifetime = useRef<{ active: boolean; busy: boolean } | null>(null);
  const copyTimer = useRef<number | null>(null);
  // Relay credentials have no refresh grant; these reads never sign in for the user.
  const [relayStatus, setRelayStatus] = useState<DesktopMobileRelayStatus | null>(null);
  const [relayUnavailable, setRelayUnavailable] = useState(false);
  const [relayReading, setRelayReading] = useState(false);
  const relayLifetime = useRef<{ active: boolean; busy: boolean; revision: number } | null>(null);

  const loadRelayStatus = useCallback(async () => {
    const lifetime = relayLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    const revision = lifetime.revision;
    setRelayReading(true);
    try {
      const status = await api.getMobileRelayStatus();
      if (lifetime.active && lifetime.revision === revision) {
        setRelayStatus(status);
        setRelayUnavailable(false);
      }
    } catch {
      if (lifetime.active && lifetime.revision === revision) setRelayUnavailable(true);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setRelayReading(false);
    }
  }, []);

  useEffect(() => {
    const lifetime = { active: true, busy: false, revision: 0 };
    relayLifetime.current = lifetime;
    const off = api.onMobileRelayStatus?.((status) => {
      if (!lifetime.active) return;
      lifetime.revision++;
      setRelayStatus(status);
      setRelayUnavailable(false);
    });
    void loadRelayStatus();
    return () => {
      lifetime.active = false;
      if (relayLifetime.current === lifetime) relayLifetime.current = null;
      off?.();
    };
  }, [loadRelayStatus]);

  const loadPairingInfo = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const lifetime = pairingLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const info = await api.getMobilePairingInfo();
      if (!lifetime.active) return;
      const qr = await QRCode.toDataURL(info.deepLink, {
        errorCorrectionLevel: 'M', margin: 1, width: 220,
        color: { dark: '#111827', light: '#ffffff' },
      });
      if (!lifetime.active) return;
      setSnapshot({ pairing: info, qrDataUrl: qr });
      setCopyStatus('idle');
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    } catch {
      if (lifetime.active) setError(t.desktopSettings.mobilePairingLoadFailed);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) { setLoading(false); setRefreshing(false); }
    }
  }, [t.desktopSettings.mobilePairingLoadFailed]);

  useEffect(() => {
    const lifetime = { active: true, busy: false };
    pairingLifetime.current = lifetime;
    void loadPairingInfo();
    return () => {
      lifetime.active = false;
      if (pairingLifetime.current === lifetime) pairingLifetime.current = null;
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, [loadPairingInfo]);

  const copyPairingLink = useCallback(async () => {
    const lifetime = pairingLifetime.current;
    if (!pairing?.deepLink || !lifetime?.active) return;
    try {
      await navigator.clipboard.writeText(pairing.deepLink);
      if (!lifetime.active) return;
      setCopyStatus('copied');
    } catch {
      if (!lifetime.active) return;
      setCopyStatus('failed');
    }
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      if (lifetime.active) setCopyStatus('idle');
    }, 2500);
  }, [pairing?.deepLink]);

  const [signInBusy, setSignInBusy] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const signInLifetime = useRef<{ active: boolean; busy: boolean } | null>(null);
  useEffect(() => {
    const lifetime = { active: true, busy: false };
    signInLifetime.current = lifetime;
    return () => { lifetime.active = false; if (signInLifetime.current === lifetime) signInLifetime.current = null; };
  }, []);
  const openRelaySignIn = useCallback(async () => {
    const lifetime = signInLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    setSignInBusy(true);
    setSignInFailed(false);
    try {
      const result = await api.openMobileRelaySignIn();
      if (lifetime.active) setSignInFailed(!result || typeof result !== 'object' || result.ok !== true || typeof result.url !== 'string' || result.url.length === 0);
    } catch {
      if (lifetime.active) setSignInFailed(true);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setSignInBusy(false);
    }
  }, []);

  const relayReady = Boolean(pairing?.relayUrl && pairing.relayJwt && pairing.relayRoomSecret);

  return (
    <div className="space-y-6">
      <Section>
        <SectionHeader icon={Smartphone}>{t.desktopSettings.mobilePairingTitle}</SectionHeader>
        {signInFailed && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t.desktopSettings.mobileRelaySignInFailed}</div>}
        {relayUnavailable && (
          <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <div>{t.desktopSettings.mobileRelayReadUnavailable}</div>
            <button type="button" onClick={() => void loadRelayStatus()} disabled={relayReading} className={`${btnSecondary} mt-2`}>
              {t.desktopSettings.mobileRelayReadRetry}
            </button>
          </div>
        )}
        {relayStatus && relayStatus.credentialState !== 'ok' && (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              relayStatus.requiresUserReauth
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-[var(--c-border)] bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
            }`}
          >
            <div className="font-medium">
              {relayStatus.credentialState === 'expired' && t.desktopSettings.mobileRelayStateExpired}
              {relayStatus.credentialState === 'rejected' && t.desktopSettings.mobileRelayStateRejected}
              {relayStatus.credentialState === 'missing' && t.desktopSettings.mobileRelayStateMissing}
              {relayStatus.credentialState === 'unparseable' && t.desktopSettings.mobileRelayStateUnparseable}
            </div>
            {relayStatus.credentialExpiresAt && (
              <div className="mt-1 text-xs opacity-80">
                {t.desktopSettings.mobileRelayExpiredAt}: {new Date(relayStatus.credentialExpiresAt).toLocaleString()}
              </div>
            )}
            <div className="mt-1 text-xs opacity-80">{t.desktopSettings.mobileRelayReauthHint}</div>
            {relayStatus.requiresUserReauth && relayStatus.relayUrl && (
              <button
                type="button"
                onClick={() => { void openRelaySignIn(); }}
                disabled={signInBusy}
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white"
              >
                {t.desktopSettings.mobileRelaySignInAction}
              </button>
            )}
          </div>
        )}
        <Card>
          {error && (
            <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <div>{error}</div>
              {!pairing && <button type="button" onClick={() => void loadPairingInfo('refresh')} disabled={refreshing} className={`${btnSecondary} mt-2`}>{t.desktopSettings.mobilePairingRefresh}</button>}
            </div>
          )}
          {loading && !pairing ? (
            <div className="flex items-center gap-2 text-sm text-[var(--c-text-secondary)]">
              <Loader2 size={14} className="animate-spin" />
              <span>{t.desktopSettings.mobilePairingLoading}</span>
            </div>
          ) : pairing ? (
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-[240px] items-center justify-center rounded-lg border border-[var(--c-border)] bg-white p-3">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt={t.desktopSettings.mobilePairingQrAlt} className="size-full object-contain" />
                  ) : (
                    <QrCode size={64} className="text-[var(--c-text-muted)]" />
                  )}
                </div>
                <div className="flex w-full gap-2">
                  <button type="button" onClick={copyPairingLink} className={`${btnSecondary} flex flex-1 items-center justify-center gap-2 px-3`}>
                    <Copy size={14} />
                    <span>{t.desktopSettings.mobilePairingCopyLink}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadPairingInfo('refresh')}
                    disabled={refreshing}
                    className={`${btnSecondary} flex items-center justify-center px-3`}
                    title={t.desktopSettings.mobilePairingRefresh}
                    aria-label={t.desktopSettings.mobilePairingRefresh}
                  >
                    <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                  </button>
                </div>
                {copyStatus !== 'idle' && (
                  <div className={copyStatus === 'copied' ? 'text-xs text-emerald-600' : 'text-xs text-red-600'}>
                    {copyStatus === 'copied' ? t.desktopSettings.mobilePairingCopied : t.desktopSettings.mobilePairingCopyFailed}
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-4">
                <div>
                  <div className="text-sm font-medium text-[var(--c-text-primary)]">{t.desktopSettings.mobilePairingScanTitle}</div>
                  <p className="mt-1 text-sm leading-6 text-[var(--c-text-secondary)]">{t.desktopSettings.mobilePairingScanDesc}</p>
                </div>
                <div className="grid gap-2 text-sm">
                  <MobileInfoRow label={t.desktopSettings.mobilePairingDesktopId} value={pairing.desktopId} />
                  <MobileInfoRow label={t.desktopSettings.mobilePairingLanAddress} value={pairing.gatewayURL || t.desktopSettings.mobilePairingNoLanAddress} />
                  <MobileInfoRow label={t.desktopSettings.mobilePairingRelay} value={relayReady ? t.desktopSettings.mobilePairingRelayReady : t.desktopSettings.mobilePairingRelayMissing} tone={relayReady ? 'ok' : 'warn'} />
                  <MobileInfoRow label={t.desktopSettings.mobilePairingReachableCount} value={t.desktopSettings.mobilePairingReachableCountValue(pairing.reachableURLs.length)} />
                </div>
                <div className="rounded-lg bg-[var(--c-bg-deep)] px-3 py-2 text-xs leading-5 text-[var(--c-text-secondary)]">
                  {t.desktopSettings.mobilePairingSecurityNote}
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </Section>
    </div>
  );
}

function MobileInfoRow({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'ok' | 'warn' }) {
  const toneClass = tone === 'ok'
    ? 'text-emerald-600'
    : tone === 'warn'
      ? 'text-amber-600'
      : 'text-[var(--c-text-primary)]';
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--c-border)] px-3 py-2">
      <span className="shrink-0 text-xs text-[var(--c-text-tertiary)]">{label}</span>
      <span className={`min-w-0 truncate text-right text-xs font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}
