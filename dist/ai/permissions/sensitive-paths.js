import { basename, sep } from 'path';
export const SENSITIVE_BASENAMES = new Set([
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    '.env.staging',
    '.env.test',
    'id_rsa',
    'id_ed25519',
    'id_ecdsa',
    'id_dsa',
    '.npmrc',
    '.netrc',
    'credentials.json',
    'secrets.json',
    '.git-credentials',
    'auth.json',
]);
export const SENSITIVE_GLOB_EXTENSIONS = [
    '.pem',
    '.key',
    '.p12',
    '.pfx',
    '.cer',
    '.crt',
];
export const SENSITIVE_PATH_SEGMENTS = [
    '.ssh',
    '.aws',
    '.gnupg',
];
function getBasename(absPath) {
    const normalized = absPath.replace(/\\/g, '/');
    return basename(normalized);
}
function getSegments(absPath) {
    return absPath.split(/[\\/]+/).filter(Boolean);
}
export function isSensitivePath(absPath) {
    if (!absPath)
        return false;
    const base = getBasename(absPath);
    if (SENSITIVE_BASENAMES.has(base))
        return true;
    for (const ext of SENSITIVE_GLOB_EXTENSIONS) {
        if (base.toLowerCase().endsWith(ext))
            return true;
    }
    const segments = getSegments(absPath);
    for (const segment of SENSITIVE_PATH_SEGMENTS) {
        if (segments.includes(segment))
            return true;
    }
    return false;
}
const SENSITIVE_TOOLS = new Set(['read', 'write', 'edit']);
const SCREEN_AUTOMATION_COMMAND_PATTERNS = [
    /(^|[\s;&|])screencapture(?:\s|$)/i,
    /(^|[\s;&|])cliclick(?:\s|$)/i,
    /(^|[\s;&|/])cua-driver(?:\s|$|[/.])/i,
    /\bCuaDriver(?:\.app)?\b/i,
    /\bcom\.trycua\.driver\b/i,
    /(^|[\s;&|])osascript\b[\s\S]*(?:System Events|AXUIElement|keystroke|key code|click|window|screen|screenshot|capture)/i,
];
export function isSensitiveToolInvocation(toolName, input) {
    if (!SENSITIVE_TOOLS.has(toolName))
        return false;
    const candidate = typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
            ? input.path
            : '';
    return isSensitivePath(candidate);
}
export function isScreenAutomationFallbackInvocation(toolName, input) {
    if (toolName !== 'bash')
        return false;
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command)
        return false;
    return SCREEN_AUTOMATION_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
export function describeSensitiveTarget(input) {
    const candidate = typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
            ? input.path
            : '';
    if (!candidate)
        return '';
    return getBasename(candidate);
}
export const __TEST_ONLY__ = { sep };
