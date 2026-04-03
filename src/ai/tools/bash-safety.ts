export type BashRiskLevel = 'safe' | 'warn' | 'block';

export interface BashRiskResult {
  level: BashRiskLevel;
  reason?: string;
}

const BLOCK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+\/\s*$/, reason: 'rm -rf /' },
  { pattern: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+~\s*$/, reason: 'rm -rf ~' },
  { pattern: /\bmkfs\b/, reason: 'filesystem format' },
  { pattern: /\bdd\s+if=/, reason: 'dd raw disk write' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, reason: 'fork bomb' },
  { pattern: />\s*\/dev\/[sh]d[a-z]/, reason: 'raw device write' },
  { pattern: /chmod\s+-R\s+777\s+\/\s*$/, reason: 'chmod 777 /' },
  { pattern: /\b(curl|wget)\s+[^\|]*\|\s*(sh|bash|zsh)\b/, reason: 'remote code execution via pipe' },
];

const WARN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-[^\s]*r[^\s]*f/, reason: 'recursive force delete' },
  { pattern: /git\s+reset\s+--hard/, reason: 'git reset --hard' },
  { pattern: /git\s+push\s+[^\n]*--force/, reason: 'git push --force' },
  { pattern: /git\s+push\s+[^\n]*-f\b/, reason: 'git push -f' },
  { pattern: /git\s+clean\s+-[^\s]*f/, reason: 'git clean -f' },
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i, reason: 'DROP TABLE/DATABASE' },
  { pattern: /\bkill\s+-9\b/, reason: 'kill -9' },
  { pattern: /\bkillall\b/, reason: 'killall' },
  { pattern: /chmod\s+[^\s]*-R/, reason: 'recursive chmod' },
  { pattern: /chown\s+[^\s]*-R/, reason: 'recursive chown' },
];

export function classifyBashCommand(command: string): BashRiskResult {
  const trimmed = command.trim();

  for (const { pattern, reason } of BLOCK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { level: 'block', reason };
    }
  }

  for (const { pattern, reason } of WARN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { level: 'warn', reason };
    }
  }

  return { level: 'safe' };
}
