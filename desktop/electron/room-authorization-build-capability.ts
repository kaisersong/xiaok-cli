// Ordinary builds remain legacy. Only a separately qualified QA/release build
// may replace this compile-time value; an environment variable cannot grant it.
export const ROOM_AUTHORIZATION_PROJECTION_CAPABLE: boolean = false;

export function selectRoomAuthorizationReadMode(capable: boolean, requested: string | undefined) {
  const enabled = requested === 'projection';
  return {
    activeMode: capable && enabled ? 'projection' as const : 'legacy' as const,
    capabilityDenied: enabled && !capable,
  };
}
