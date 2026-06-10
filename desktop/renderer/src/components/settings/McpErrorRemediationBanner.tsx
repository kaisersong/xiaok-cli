import { useState, type ReactElement } from 'react';
import { AlertTriangle, ExternalLink, Copy, Check } from 'lucide-react';
import type { PluginMcpErrorDetail } from '../../../../electron/preload-api';

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
    const versionInfo = detail.requiredVersion
      ? `${serverName} 需要 Python ${detail.requiredVersion} 或更高版本`
      : `${serverName} 需要 Python 3.10 或更高版本`;
    const detected = detail.detectedVersion ? `当前检测到 Python ${detail.detectedVersion}。` : '';

    const suggestions: CommandSuggestion[] = [
      { label: '复制 brew 命令', command: 'brew install python@3.12' },
      { label: '复制 pyenv 命令', command: 'pyenv install 3.12 && pyenv global 3.12' },
    ];

    return (
      <div className="mt-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-xs">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-yellow-700" size={14} />
          <div className="flex-1">
            <div className="font-medium text-yellow-900">{versionInfo}</div>
            <div className="mt-1 text-yellow-800">
              {detected}此 MCP 服务无法在你当前的 Python 上启动。请用以下任一方式升级到 Python 3.10+，然后重启 Xiaok Desktop。
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <a
                href="https://www.python.org/downloads/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-yellow-300 bg-white px-2 py-1 text-yellow-900 hover:bg-yellow-100"
              >
                <ExternalLink size={12} />
                官网下载
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
                    <span className="font-sans">{copied ? '已复制' : s.label}</span>
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
              Python 模块缺失{moduleName ? `：${moduleName}` : ''}
            </div>
            <div className="mt-1 text-[var(--c-text-secondary)]">
              此 MCP 服务依赖的 Python 包未安装。运行以下命令后重启 Xiaok Desktop。
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleCopy('pip', installCommand)}
                className="inline-flex items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1 font-mono text-[var(--c-text-primary)] hover:bg-[var(--c-bg-hover)]"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span className="font-sans">{copied ? '已复制' : '复制命令'}</span>
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
