export interface DesktopRendererPermissionPolicyInput {
  permission: string;
  mediaTypes: readonly string[];
  isMainWindowWebContents: boolean;
  isMeetingRecorderWebContents: boolean;
}

export function readMediaTypesFromPermissionDetails(details: unknown): readonly string[] {
  if (!details || typeof details !== 'object') return [];
  const mediaTypes = (details as { mediaTypes?: unknown }).mediaTypes;
  if (!Array.isArray(mediaTypes)) return [];
  return mediaTypes.filter((type): type is string => typeof type === 'string');
}

export function shouldAllowDesktopRendererPermission(input: DesktopRendererPermissionPolicyInput): boolean {
  if (input.permission === 'clipboard-sanitized-write') {
    return input.isMainWindowWebContents;
  }
  if (input.permission !== 'media') return false;
  if (!input.isMainWindowWebContents && !input.isMeetingRecorderWebContents) return false;
  return input.mediaTypes.includes('audio');
}
