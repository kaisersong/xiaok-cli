export type AutomationFocusKind = 'loop' | 'task';

export function automationFocusTargetId(hash: string, kind: AutomationFocusKind): string | null {
  const prefix = `#${kind}-`;
  if (!hash.startsWith(prefix) || hash.length === prefix.length) return null;
  return hash.slice(1);
}
