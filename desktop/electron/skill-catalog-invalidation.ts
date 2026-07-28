let version = 0;
const listeners = new Set<() => void>();

export function getSkillCatalogVersion(): number {
  return version;
}

export function bumpSkillCatalogVersion(): void {
  version += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Listener failures must not break the install/uninstall flow.
    }
  }
}

export function onSkillCatalogChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
