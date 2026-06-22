import { useState, type ReactElement } from 'react';
import { AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react';
import type { PluginMcpErrorDetail } from '../../../../electron/preload-api';
import { useLocale } from '../../contexts/LocaleContext';

interface Props {
  detail: PluginMcpErrorDetail;
  serverName: string;
}

interface CommandSuggestion {
  label: string;
  command: string;
  hint?: string;
}

export function McpErrorRemediationBanner({ detail, serverName }: Props): ReactElement | null {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { t } = useLocale();
  const ds = t.desktopSettings;

  if (!detail.category) {
    return null;
  }

  const handleCopy = async (key: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    } catch {
      // Clipboard access may be blocked; ignore silently.
    }
  };

  if (detail.category === 'python_version_too_old') {
    const versionInfo = ds.mcpPythonVersionTooOld(serverName, detail.requiredVersion ?? '3.10');
    const detected = detail.detectedVersion ? ds.mcpPythonDetected(detail.detectedVersion) : '';

    const suggestions: CommandSuggestion[] = [
      { label: 'brew', command: 'brew install python@3.12' },
      { label: 'pyenv', command: 'pyenv install 3.12 && pyenv global 3.12' },
    ];

    const suggestionLabels: Record<string, string> = {
      brew: ds.mcpPythonCopyBrew,
      pyenv: ds.mcpPythonCopyPyenv,
    };

    return (
      <div className="mt-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-xs">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-yellow-700" size={14} />
          <div className="flex-1">
            <div className="font-medium text-yellow-900">{versionInfo}</div>
            <div className="mt-1 text-yellow-800">
              {detected}{ds.mcpPythonUpgradeHint}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <a
                href="https://www.python.org/downloads/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-yellow-300 bg-white px-2 py-1 text-yellow-900 hover:bg-yellow-100"
              >
                <ExternalLink size={12} />
                {ds.mcpPythonOfficialDownload}
              </a>
              {suggestions.map((s) => {
                const copied = copiedKey === s.label;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => handleCopy(s.label, s.command)}
                    className="inline-flex items-center gap-1 rounded border border-yellow-300 bg-white px-2 py-1 font-mono text-yellow-900 hover:bg-yellow-100"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    <span className="font-sans">{copied ? ds.mcpPythonCopied : suggestionLabels[s.label]}</span>
                    <span className="text-yellow-700">{s.command}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (detail.category === 'python_module_missing') {
    const moduleName = detail.missingModule ?? '';
    const installCommand = moduleName ? `pip install --upgrade ${moduleName}` : 'pip install --upgrade <module>';
    const copied = copiedKey === 'pip';

    return (
      <div className="mt-2 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-deep)] p-3 text-xs">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-[var(--c-text-secondary)]" size={14} />
          <div className="flex-1">
            <div className="font-medium text-[var(--c-text-primary)]">
              {ds.mcpPythonModuleMissing(moduleName)}
            </div>
            <div className="mt-1 text-[var(--c-text-secondary)]">
              {ds.mcpPythonModuleMissingDesc}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleCopy('pip', installCommand)}
                className="inline-flex items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1 font-mono text-[var(--c-text-primary)] hover:bg-[var(--c-bg-hover)]"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span className="font-sans">{copied ? ds.mcpPythonCopied : ds.mcpPythonCopyCommand}</span>
                <span>{installCommand}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
