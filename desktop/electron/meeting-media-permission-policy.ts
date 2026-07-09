export interface MeetingMediaPermissionPolicyInput {
  permission: string;
  mediaTypes: readonly string[];
  isTrustedWebContents: boolean;
}

export function readMediaTypesFromPermissionDetails(details: unknown): readonly string[] {
  if (!details || typeof details !== 'object') return [];
  const mediaTypes = (details as { mediaTypes?: unknown }).mediaTypes;
  if (!Array.isArray(mediaTypes)) return [];
  return mediaTypes.filter((type): type is string => typeof type === 'string');
}

export function shouldAllowMeetingMediaPermission(input: MeetingMediaPermissionPolicyInput): boolean {
  if (!input.isTrustedWebContents) return false;
  if (input.permission !== 'media') return false;
  return input.mediaTypes.includes('audio');
}
