const BLOCK_PATTERNS = [
    { pattern: /\bsudo\b/, reason: 'sudo requires password which cannot be provided via Bash tool (stdin disabled). Use `! sudo <command>` to instruct user to run manually' },
    { pattern: /(^|[\s;&|])screencapture(?:\s|$)/i, reason: 'screen capture must use xiaok_computer_use, not shell fallback' },
    { pattern: /(^|[\s;&|])cliclick(?:\s|$)/i, reason: 'desktop control must use xiaok_computer_use, not shell fallback' },
    { pattern: /(^|[\s;&|/])cua-driver(?:\s|$|[/.])/i, reason: 'CUA driver must be managed by Xiaok Computer Use, not shell fallback' },
    { pattern: /\bCuaDriver(?:\.app)?\b/i, reason: 'CUA driver must be managed by Xiaok Computer Use, not shell fallback' },
    { pattern: /\bcom\.trycua\.driver\b/i, reason: 'CUA driver must be managed by Xiaok Computer Use, not shell fallback' },
    { pattern: /\bosascript\b[\s\S]*(?:System Events|AXUIElement|keystroke|key code|click|window|screen|screenshot|capture)/i, reason: 'desktop automation must use xiaok_computer_use, not shell fallback' },
    { pattern: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+\/\s*$/, reason: 'rm -rf /' },
    { pattern: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+~\s*$/, reason: 'rm -rf ~' },
    { pattern: /\bmkfs\b/, reason: 'filesystem format' },
    { pattern: /\bdd\s+if=/, reason: 'dd raw disk write' },
    { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, reason: 'fork bomb' },
    { pattern: />\s*\/dev\/[sh]d[a-z]/, reason: 'raw device write' },
    { pattern: /chmod\s+-R\s+777\s+\/\s*$/, reason: 'chmod 777 /' },
    { pattern: /\b(curl|wget)\s+[^\|]*\|\s*(sh|bash|zsh)\b/, reason: 'remote code execution via pipe' },
    { pattern: /\b(base64|openssl)\s+[^\|]*(-d|--decode|-D|dec)\b[^\|]*\|\s*(sh|bash|zsh)\b/, reason: 'encoded payload piped to shell' },
    { pattern: /\|\s*(sh|bash|zsh)\s*$/, reason: 'arbitrary pipe to shell interpreter' },
];
const WARN_PATTERNS = [
    { pattern: /rm\s+-[^\s]*r[^\s]*f/, reason: 'recursive force delete' },
    { pattern: /\bRemove-Item\b[\s\S]*(?:-Recurse|-r\b)[\s\S]*(?:-Force|-f\b)/i, reason: 'PowerShell recursive force delete' },
    { pattern: /\bRemove-Item\b[\s\S]*(?:-Force|-f\b)[\s\S]*(?:-Recurse|-r\b)/i, reason: 'PowerShell recursive force delete' },
    { pattern: /(^|[\s;&|])(?:rmdir|rd)\s+[\s\S]*\/s\b/i, reason: 'Windows recursive directory delete' },
    { pattern: /(^|[\s;&|])(?:del|erase)\s+[\s\S]*\/s\b/i, reason: 'Windows recursive file delete' },
    { pattern: /git\s+reset\s+--hard/, reason: 'git reset --hard' },
    { pattern: /git\s+push\s+[^\n]*--force/, reason: 'git push --force' },
    { pattern: /git\s+push\s+[^\n]*-f\b/, reason: 'git push -f' },
    { pattern: /git\s+clean\s+-[^\s]*f/, reason: 'git clean -f' },
    { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i, reason: 'DROP TABLE/DATABASE' },
    { pattern: /\bkill\s+-9\b/, reason: 'kill -9' },
    { pattern: /\bkillall\b/, reason: 'killall (may trigger sudo on macOS)' },
    { pattern: /chmod\s+[^\s]*-R/, reason: 'recursive chmod' },
    { pattern: /chown\s+[^\s]*-R/, reason: 'recursive chown' },
    { pattern: /\b(python[23]?|ruby|perl|node)\s+(-[ce]|--eval)\b/, reason: 'interpreter eval may execute system commands' },
    { pattern: /\|\s*(python[23]?|ruby|perl|node)\b/, reason: 'pipe to interpreter' },
    { pattern: /(?:^|[;&|]\s*)eval\b/, reason: 'eval executes dynamically constructed commands' },
];
const AUTO_PROMPT_PATTERNS = [
    { pattern: /rm\s+-[^\s]*r[^\s]*f/, reason: 'recursive force delete' },
    { pattern: /\bRemove-Item\b[\s\S]*(?:-Recurse|-r\b)[\s\S]*(?:-Force|-f\b)/i, reason: 'PowerShell recursive force delete' },
    { pattern: /\bRemove-Item\b[\s\S]*(?:-Force|-f\b)[\s\S]*(?:-Recurse|-r\b)/i, reason: 'PowerShell recursive force delete' },
    { pattern: /(^|[\s;&|])(?:rmdir|rd)\s+[\s\S]*\/s\b/i, reason: 'Windows recursive directory delete' },
    { pattern: /(^|[\s;&|])(?:del|erase)\s+[\s\S]*\/s\b/i, reason: 'Windows recursive file delete' },
    { pattern: /git\s+reset\s+--hard/, reason: 'git reset --hard' },
    { pattern: /git\s+push\s+[^\n]*--force/, reason: 'git push --force' },
    { pattern: /git\s+push\s+[^\n]*-f\b/, reason: 'git push -f' },
    { pattern: /git\s+clean\s+-[^\s]*f/, reason: 'git clean -f' },
    { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i, reason: 'DROP TABLE/DATABASE' },
];
export function classifyBashCommand(command) {
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
export function requiresAutoPromptForBashCommand(command) {
    const trimmed = command.trim();
    for (const { pattern, reason } of AUTO_PROMPT_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { level: 'warn', reason };
        }
    }
    return null;
}
