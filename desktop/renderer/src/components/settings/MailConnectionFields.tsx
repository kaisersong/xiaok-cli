import { useLocale } from '../../contexts/LocaleContext';
import type { MailProvider } from '../../../../shared/mail-connectors-ipc-contract';

export const helpUrls:Partial<Record<MailProvider,string>>={qq:'https://mail.qq.com',netease163:'https://mail.163.com',gmail:'https://developers.google.com/identity/protocols/oauth2/native-app',outlook:'https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app'};
export const inputClass='w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2.5 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]';

interface MailConnectionFieldsProps {
  provider: MailProvider;
  connected: boolean;
  email: string;
  password: string;
  host: string;
  port: number;
  clientId: string;
  clientSecret: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setHost: (value: string) => void;
  setPort: (value: number) => void;
  setClientId: (value: string) => void;
  setClientSecret: (value: string) => void;
}

/** Controlled credential fields; account state, grants and submissions stay with the parent. */
export function MailConnectionFields({ provider, connected, email, password, host, port, clientId, clientSecret,
  setEmail, setPassword, setHost, setPort, setClientId, setClientSecret }: MailConnectionFieldsProps) {
  const { t } = useLocale();
  const labels = t.mailConnectors;
  const authGuideProvider = provider === 'qq' || provider === 'netease163' ? provider : null;
  return <>{provider==='gmail'||provider==='outlook'?<><p className="rounded-lg bg-[var(--c-bg-deep)] p-3 text-xs leading-6 text-[var(--c-text-secondary)]">{labels.oauthSetup}</p><label className="block text-xs text-[var(--c-text-secondary)]">{labels.clientId}<input required value={clientId} onChange={e=>setClientId(e.target.value)} className={`${inputClass} mt-2`} autoComplete="off"/></label>{provider==='gmail'&&<label className="block text-xs text-[var(--c-text-secondary)]">{labels.clientSecret}<input type="password" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} className={`${inputClass} mt-2`} autoComplete="new-password"/></label>}</>:<><label className="block text-xs text-[var(--c-text-secondary)]">{labels.email}<input required type="email" value={email} disabled={connected} onChange={e=>setEmail(e.target.value)} className={`${inputClass} mt-2`} autoComplete="off"/></label>{provider==='imap'&&<div className="grid grid-cols-[1fr_100px] gap-3"><label className="block text-xs text-[var(--c-text-secondary)]">{labels.host}<input required value={host} disabled={connected} onChange={e=>setHost(e.target.value)} className={`${inputClass} mt-2`}/></label><label className="block text-xs text-[var(--c-text-secondary)]">{labels.port}<input type="number" min={1} max={65535} value={port} disabled={connected} onChange={e=>setPort(Number(e.target.value))} className={`${inputClass} mt-2`}/></label></div>}<label className="block text-xs text-[var(--c-text-secondary)]">{labels.password}<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} className={`${inputClass} mt-2`} autoComplete="new-password"/></label>{authGuideProvider&&<section aria-label={labels.authCodeTitle} className="rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-deep)] p-3"><h4 className="text-xs font-medium text-[var(--c-text-primary)]">{labels.authCodeTitle}</h4><ol className="mt-2 list-decimal space-y-2 pl-4 text-xs leading-5 text-[var(--c-text-secondary)]">{labels.authGuides[authGuideProvider].map((step,index)=><li key={index}>{step}</li>)}</ol><a className="mt-3 inline-block text-xs text-[var(--c-accent)] underline" href={helpUrls[authGuideProvider]} target="_blank" rel="noreferrer">{labels.openWebmail(labels.providers[authGuideProvider].name)}</a><p className="mt-2 text-xs leading-5 text-[var(--c-text-secondary)]">{labels.authCodeHint}</p></section>}</>}</>;
}
