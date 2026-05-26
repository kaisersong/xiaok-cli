import { basename, sep } from 'path';

export const SENSITIVE_BASENAMES: ReadonlySet<string> = new Set([
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

export const SENSITIVE_GLOB_EXTENSIONS: readonly string[] = [
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.cer',
  '.crt',
];

export const SENSITIVE_PATH_SEGMENTS: readonly string[] = [
  '.ssh',
  '.aws',
  '.gnupg',
];

function getBasename(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  return basename(normalized);
}

function getSegments(absPath: string): string[] {
  return absPath.split(/[\\/]+/).filter(Boolean);
}

export function isSensitivePath(absPath: string): boolean {
  if (!absPath) return false;
  const base = getBasename(absPath);
  if (SENSITIVE_BASENAMES.has(base)) return true;
  for (const ext of SENSITIVE_GLOB_EXTENSIONS) {
    if (base.toLowerCase().endsWith(ext)) return true;
  }
  const segments = getSegments(absPath);
  for (const segment of SENSITIVE_PATH_SEGMENTS) {
    if (segments.includes(segment)) return true;
  }
  return false;
}

const SENSITIVE_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit']);

const SCREEN_AUTOMATION_COMMAND_PATTERNS: readonly RegExp[] = [
  /(^|[\s;&|])screencapture(?:\s|$)/i,
  /(^|[\s;&|])cliclick(?:\s|$)/i,
  /(^|[\s;&|])cua-driver(?:\s|$)/i,
  /(^|[\s;&|])osascript\b[\s\S]*(?:System Events|AXUIElement|keystroke|key code|click|window|screen|screenshot|capture)/i,
];

export function isSensitiveToolInvocation(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (!SENSITIVE_TOOLS.has(toolName)) return false;
  const candidate =
    typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.path === 'string'
        ? input.path
        : '';
  return isSensitivePath(candidate);
}

export function isScreenAutomationFallbackInvocation(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (toolName !== 'bash') return false;
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (!command) return false;
  return SCREEN_AUTOMATION_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function describeSensitiveTarget(input: Record<string, unknown>): string {
  const candidate =
    typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.path === 'string'
        ? input.path
        : '';
  if (!candidate) return '';
  return getBasename(candidate);
}

export const __TEST_ONLY__ = { sep };
