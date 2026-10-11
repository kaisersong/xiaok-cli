import { useEffect, useState } from 'react';
import { getDesktopApi } from '../shared/desktop';
import { useLocale } from '../contexts/LocaleContext';
import type { McpInputForm } from '../../../shared/conversation-activity-types.js';

export function McpWorkControls({ watchId, needsInput, revision }: { watchId: string; needsInput: boolean; revision: number }) {
  const { t } = useLocale(); const labels = t.conversationActivity;
  const [forms, setForms] = useState<McpInputForm[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(false), [cancelRequested, setCancelRequested] = useState(false);
  useEffect(() => {
    let live = true;
    if (!needsInput) { setForms([]); return; }
    const api = getDesktopApi();
    if (!api?.getMcpTaskInputs) { setError(true); return; }
    void api.getMcpTaskInputs(watchId).then(value => { if (live) { setForms(value); setError(false); } }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [watchId, needsInput, revision]);
  const cancel = async () => {
    setBusy(true); setError(false);
    try { const api = getDesktopApi(); if (!api) throw new Error('activity_unavailable'); await api.cancelMcpWork(watchId); setCancelRequested(true); } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 space-y-3">
    {forms.map(form => <McpInputFields key={form.inputId} watchId={watchId} form={form} />)}
    {needsInput && !forms.length && !error && <p className="text-xs text-[var(--c-text-muted)]">{labels.unsupportedInput}</p>}
    {error && <p role="alert" className="text-xs text-[var(--c-error)]">{labels.error}</p>}
    <button type="button" disabled={busy || cancelRequested} onClick={() => { void cancel(); }} className="text-xs text-[var(--c-text-secondary)]">{cancelRequested ? labels.cancelRequested : labels.cancelWork}</button>
  </div>;
}

function McpInputFields({ watchId, form }: { watchId: string; form: McpInputForm }) {
  const { t } = useLocale(), labels = t.conversationActivity;
  const [values, setValues] = useState<Record<string, unknown>>({}), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const answer = async (action: 'accept' | 'decline') => {
    setBusy(true); setError(false);
    try {
      const api = getDesktopApi(); if (!api) throw new Error('activity_unavailable');
      const content = { ...values };
      for (const field of form.fields) if (field.type === 'boolean' && content[field.key] === undefined) content[field.key] = false;
      await api.answerMcpTaskInput({ watchId, inputId: form.inputId, expectedDigest: form.expectedDigest, action, ...(action === 'accept' ? { content } : {}) });
    }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <form className="space-y-2 rounded border border-[var(--c-border)] p-3" onSubmit={event => { event.preventDefault(); void answer('accept'); }}>
    <p className="whitespace-pre-wrap text-sm">{form.prompt}</p>
    {form.fields.map(field => <label key={field.key} className="block text-xs text-[var(--c-text-secondary)]">
      <span>{field.title}</span>
      {field.type === 'boolean' ? <input type="checkbox" checked={values[field.key] === true} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.checked }))} disabled={busy} className="ml-2" />
        : field.type === 'choice' || field.type === 'choices' ? <select multiple={field.type === 'choices'} required={field.required} disabled={busy}
          value={(values[field.key] ?? (field.type === 'choices' ? [] : '')) as string | string[]}
          onChange={event => setValues(previous => ({ ...previous, [field.key]: field.type === 'choices' ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value }))}
          className="mt-1 block w-full rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] p-2">
          {field.type === 'choice' && <option value="" />}{field.options?.map(option => <option key={option} value={option}>{option}</option>)}
        </select> : <input type={field.type === 'number' ? 'number' : 'text'} step={field.type === 'number' ? 'any' : undefined} maxLength={4096} required={field.required} disabled={busy}
          value={String(values[field.key] ?? '')} onChange={event => setValues(previous => ({ ...previous, [field.key]: field.type === 'number' ? Number(event.target.value) : event.target.value }))}
          className="mt-1 block w-full rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] p-2" />}
    </label>)}
    {error && <p role="alert" className="text-xs text-[var(--c-error)]">{labels.error}</p>}
    <div className="flex gap-3"><button type="submit" disabled={busy} className="text-xs text-[var(--c-accent)]">{labels.submitInput}</button>
      <button type="button" disabled={busy} onClick={() => { void answer('decline'); }} className="text-xs text-[var(--c-text-secondary)]">{labels.declineInput}</button></div>
  </form>;
}
